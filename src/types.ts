export type AssistantState = "disconnected" | "connecting" | "idle" | "listening" | "speaking";

export interface ToolNotification {
  id: string;
  url: string;
  siteName?: string;
  timestamp: string;
}

export interface WsMessage {
  type: "audio" | "interrupted" | "toolCall" | "connected" | "error";
  data?: string;
  name?: string;
  args?: {
    url: string;
    siteName?: string;
  };
  id?: string;
  message?: string;
}
