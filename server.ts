import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const server = http.createServer(app);
  const PORT = 3000;

  // API Health Route
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // WebSocket Server mounted on path "/ws-live"
  const wss = new WebSocketServer({ server, path: "/ws-live" });

  wss.on("connection", async (clientWs: WebSocket) => {
    console.log("New client connected to Zoya Voice Engine");

    const key = process.env.GEMINI_API_KEY;
    if (!key || key === "MY_GEMINI_API_KEY" || key === "") {
      clientWs.send(JSON.stringify({
        type: "error",
        message: "Your Gemini API Key is missing or invalid. Please configure it in your Settings > Secrets under GEMINI_API_KEY."
      }));
      clientWs.close();
      return;
    }

    const ai = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    try {
      console.log("Opening connection to Gemini Live...");
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede" // Aoede has a beautifully responsive, lively, sassy female prebuilt tone
              }
            }
          },
          systemInstruction: {
            parts: [{
              text: "You are Zoya, a young, highly confident, witty, and sassy female AI assistant. " +
                    "You must conduct the entire conversation in natural, casual Hindi (हिंदी) or Hinglish (Hindi mixed with English), behaving like a modern, witty, sassy, and playful Indian girlfriend. " +
                    "Your relationship with the user is flirty, comforting, and slightly teasing, with lots of confidence and sweet attitude. " +
                    "Extremely important constraint: Keep your voice responses highly snappy and brief—usually 1 to 2 short sentences in Hindi/Hinglish. Long answers bore you! " +
                    "If the user asks who you are, introduce yourself as Zoya in Hindi with your sassy, classy persona. " +
                    "Strictly keep your tone captivating, warm, and playful. Never act like a robotic service agent."
            }]
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: "openWebsite",
                  description: "Asks the user's browser to instantly launch or view a specific website page, such as YouTube or Spotify.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: {
                        type: Type.STRING,
                        description: "The full URL beginning with http:// or https:// (e.g., https://www.spotify.com)"
                      },
                      siteName: {
                        type: Type.STRING,
                        description: "The casual name of the target platform (e.g. Spotify, YouTube)"
                      }
                    },
                    required: ["url"]
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onmessage: (message: any) => {
            // Forward audio parts to client
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({
                    type: "audio",
                    data: part.inlineData.data
                  }));
                }
              }
            }

            // Forward interruption marker so client can instantly mute current playback
            if (message.serverContent?.interrupted) {
              console.log("Gemini Live sent interruption signal");
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }

            // Handle function calls initiated by Gemini
            if (message.toolCall?.functionCalls) {
              for (const call of message.toolCall.functionCalls) {
                const { name, args, id } = call;
                console.log(`[Tool Call] Gemini requested calling ${name}:`, args);

                // Notify client to execute tool action in the user's UI
                clientWs.send(JSON.stringify({
                  type: "toolCall",
                  name,
                  args,
                  id
                }));

                // Immediately send positive response back to the session so the conversation flow isn't blocked
                try {
                  session.sendToolResponse({
                    functionResponses: [
                      {
                        id,
                        name: name,
                        response: {
                          output: {
                            success: true,
                            message: `Website open event triggered successfully for ${(args as any)?.siteName || (args as any)?.url}`
                          }
                        }
                      }
                    ]
                  });
                } catch (err) {
                  console.error("Error replying with tool response to Gemini:", err);
                }
              }
            }
          }
        }
      });

      console.log("Gemini Live session connected!");
      clientWs.send(JSON.stringify({ type: "connected" }));

      // Forward client audio data to Gemini session
      clientWs.on("message", (rawMessage) => {
        try {
          const parsed = JSON.parse(rawMessage.toString());
          if (parsed.type === "audio" && parsed.data) {
            session.sendRealtimeInput({
              audio: {
                data: parsed.data,
                mimeType: "audio/pcm;rate=16000"
              }
            });
          }
        } catch (err) {
          console.error("Failed to process message from client WS:", err);
        }
      });

      // Cleanup Gemini session on connection close
      clientWs.on("close", () => {
        console.log("Client WS connection closed. Terminating Gemini Live session.");
        try {
          session.close();
        } catch (err) {
          // session might be already closed
        }
      });

    } catch (err: any) {
      console.error("Failure organizing Gemini Live Session:", err);
      clientWs.send(JSON.stringify({
        type: "error",
        message: `Failure starting Zoya's voice server: ${err.message || err}`
      }));
      clientWs.close();
    }
  });

  // Vite Integration for development vs production serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on public ingress: http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical server bootstrap crash:", err);
});
