export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: "text" | "image";
  mime: string;
  data: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  model?: string;
  reasoning?: string;
  attachments?: Attachment[];
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  group?: string;
  tokenId?: number;
  systemRole: string;
  messages: Message[];
  updatedAt: number;
}

export interface ChatToken {
  id: number;
  name: string;
  masked_key: string;
  group: string;
  available: boolean;
}

export interface ChatModel {
  id: string;
  groups: string[];
}

export interface Bootstrap {
  user_id: number;
  username: string;
  models: string[];
  catalog: ChatModel[];
  group: string;
}
