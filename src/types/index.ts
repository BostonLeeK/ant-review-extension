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

export interface ClaudeConfig {
  apiKey: string;
  model: string;
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
