export interface FileChange {
  path: string;
  type: "added" | "modified" | "deleted";
  diff: string;
  content?: string;
}

export interface ReviewResult {
  file: string;
  issues: Issue[];
  suggestions: Suggestion[];
  score: number;
  summary: string;
}

export interface Issue {
  type: "error" | "warning" | "info";
  line: number;
  column?: number;
  message: string;
  rule?: string;
  source: "claude" | "ant" | "linter" | "diff";
}

export interface Suggestion {
  line: number;
  column?: number;
  message: string;
  code?: string;
  source: "claude" | "ant" | "linter" | "diff";
}

export type ClaudeModel =
  | "claude-opus-4-20250514"
  | "claude-sonnet-4-20250514"
  | "claude-3-7-sonnet-20250219"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-5-haiku-20241022"
  | "claude-3-haiku-20240307";

export interface ClaudeConfig {
  apiKey: string;
  model: ClaudeModel;
}

export interface AnalysisConfig {
  enableClaudeAnalysis: boolean;
  enableANTAnalysis: boolean;
  enableLinterAnalysis: boolean;
}

export interface WebviewMessage {
  command: string;
  data?: any;
}
