import Anthropic from "@anthropic-ai/sdk";
import * as vscode from "vscode";
import { ClaudeConfig, ClaudeModel, FileChange, ReviewResult } from "../types";
import { LoggerService } from "./LoggerService";

export const CLAUDE_MODELS = {
  OPUS_4: "claude-opus-4-20250514" as ClaudeModel,
  SONNET_4: "claude-sonnet-4-20250514" as ClaudeModel,
  SONNET_3_7: "claude-3-7-sonnet-20250219" as ClaudeModel,
  SONNET_3_5: "claude-3-5-sonnet-20241022" as ClaudeModel,
  HAIKU_3_5: "claude-3-5-haiku-20241022" as ClaudeModel,
  HAIKU_3: "claude-3-haiku-20240307" as ClaudeModel,
} as const;

export const MODEL_DISPLAY_NAMES = {
  [CLAUDE_MODELS.SONNET_3_5]: "Claude 3.5 Sonnet (Smart & Accurate)",
  [CLAUDE_MODELS.HAIKU_3_5]: "Claude 3.5 Haiku (Fast & Cheap)",
  [CLAUDE_MODELS.HAIKU_3]: "Claude 3 Haiku (Legacy Fast)",
} as const;

export class ClaudeService {
  private anthropic: Anthropic | null = null;
  private context: vscode.ExtensionContext;
  private logger: LoggerService;
  private initializationPromise: Promise<void> | null = null;
  private isInitializing = false;
  private resultCache = new Map<string, ReviewResult>();
  private currentModel: ClaudeModel = CLAUDE_MODELS.SONNET_4;

  constructor(context: vscode.ExtensionContext, logger: LoggerService) {
    this.context = context;
    this.logger = logger;
    this.initializationPromise = this.initializeFromSavedConfig();
    this.logger.info("ClaudeService initialized");
  }

  private async initializeFromSavedConfig(): Promise<void> {
    if (this.isInitializing) {
      return this.initializationPromise || Promise.resolve();
    }

    this.isInitializing = true;
    this.logger.debug("Initializing ClaudeService from saved config");

    try {
      const config = await this.getConfig();
      if (config && config.apiKey) {
        this.anthropic = new Anthropic({
          apiKey: config.apiKey,
        });
        // Load saved model preference
        if (config.model) {
          this.currentModel = config.model;
        }
        this.logger.info("ClaudeService initialized with saved config", {
          model: this.currentModel,
        });
      } else {
        this.logger.info("No saved config found for ClaudeService");
      }
    } catch (error) {
      this.logger.warn("Failed to initialize from saved config", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isInitializing = false;
    }
  }

  async waitForInitialization(): Promise<void> {
    this.logger.debug("Waiting for ClaudeService initialization");
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
    this.logger.debug("ClaudeService initialization completed");
  }

  async initialize(apiKey: string): Promise<void> {
    this.logger.logOperation("ClaudeService initialization", {
      hasApiKey: !!apiKey,
    });

    try {
      this.anthropic = new Anthropic({
        apiKey: apiKey,
      });

      await this.saveConfig({ apiKey, model: this.currentModel });
      this.logger.info("ClaudeService initialized successfully");
    } catch (error) {
      this.logger.logError("ClaudeService initialization", error);
      throw new Error(`Failed to initialize Claude: ${error}`);
    }
  }

  async analyzeFile(fileChange: FileChange): Promise<ReviewResult> {
    // Redirect to analyzeFullFile to use consistent, stricter prompting
    return this.analyzeFullFile(fileChange);
  }

  async analyzeFullFile(fileChange: FileChange): Promise<ReviewResult> {
    this.logger.logServiceCall("ClaudeService", "analyzeFullFile", {
      file: fileChange.path,
    });

    // Check cache first
    const cacheKey = this.getCacheKey(fileChange);
    const cachedResult = this.resultCache.get(cacheKey);
    if (cachedResult) {
      this.logger.debug("Returning cached result", {
        file: fileChange.path,
        cacheKey,
      });
      // Return a copy to avoid reference issues
      return {
        ...cachedResult,
        issues: [...cachedResult.issues],
        suggestions: [...cachedResult.suggestions],
      };
    }

    if (!this.anthropic) {
      const error = "Claude not initialized. Please set API key first.";
      this.logger.error("Claude not initialized for full file analysis", {
        file: fileChange.path,
      });
      throw new Error(error);
    }

    const prompt = this.getFullFileAnalysisPrompt(fileChange);
    this.logger.debug("Full file analysis prompt built", {
      file: fileChange.path,
      promptLength: prompt.length,
    });

    try {
      this.logger.debug("Sending full file analysis request to Claude API", {
        file: fileChange.path,
      });

      const response = await this.anthropic.messages.create({
        model: this.currentModel,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      this.logger.debug("Claude API full file response received", {
        file: fileChange.path,
        responseLength:
          response.content[0]?.type === "text"
            ? response.content[0].text.length
            : 0,
      });

      const content = response.content[0];
      if (content.type === "text") {
        const result = this.parseAnalysisResponse(
          content.text,
          fileChange.path
        );

        // Cache the result
        this.resultCache.set(cacheKey, result);
        this.logger.debug("Result cached", {
          file: fileChange.path,
          cacheKey,
        });

        // Log only errors and warnings
        const errorsAndWarnings = result.issues.filter(
          (issue) => issue.type === "error" || issue.type === "warning"
        );
        if (errorsAndWarnings.length > 0) {
          this.logger.logServiceResponse("ClaudeService", "analyzeFullFile", {
            file: fileChange.path,
            errorsAndWarnings,
          });
        }
        return result;
      }

      throw new Error("Invalid response format");
    } catch (error) {
      this.logger.logError("Claude full file analysis", error);
      throw new Error(`Claude full file analysis failed: ${error}`);
    }
  }

  async analyzeMultipleFiles(
    fileChanges: FileChange[]
  ): Promise<ReviewResult[]> {
    this.logger.logServiceCall("ClaudeService", "analyzeMultipleFiles", {
      fileCount: fileChanges.length,
    });

    const results: ReviewResult[] = [];

    for (const fileChange of fileChanges) {
      try {
        this.logger.debug("Analyzing file", { file: fileChange.path });
        const result = await this.analyzeFile(fileChange);
        results.push(result);
        this.logger.debug("File analysis completed", { file: fileChange.path });
      } catch (error) {
        this.logger.logError("Multiple files analysis", {
          file: fileChange.path,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        results.push({
          file: fileChange.path,
          issues: [
            {
              type: "error",
              line: 1,
              message: `Analysis failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              source: "claude",
            },
          ],
          suggestions: [],
          score: 0,
          summary: "Analysis failed",
        });
      }
    }

    this.logger.logServiceResponse("ClaudeService", "analyzeMultipleFiles", {
      totalFiles: fileChanges.length,
      successfulAnalyses: results.filter((r) => r.score > 0).length,
    });

    return results;
  }

  private getFullFileAnalysisPrompt(fileChange: FileChange): string {
    // Log content preview for debugging
    const contentPreview = (fileChange.content || "").substring(0, 300);
    this.logger.debug("Building full file analysis prompt", {
      file: fileChange.path,
      contentLength: (fileChange.content || "").length,
      contentPreview: contentPreview.replace(/\n/g, "\\n"),
      firstLine: (fileChange.content || "").split("\n")[0],
    });

    return `You are an expert code reviewer analyzing this ${this.getFileType(
      fileChange.path
    )} file. Find real bugs, logic errors, and issues that prevent the code from working correctly.

FOCUS ON:
- Variable name mismatches and typos
- Undefined variables or incorrect references  
- Logic errors and syntax issues
- Real bugs that break functionality

IGNORE:
- Standard React/Next.js patterns (hooks, contexts, providers)
- Proper error handling with 'throw new Error' in React hooks
- Standard import paths like '@/lib/axios'
- Working code that follows framework conventions

File: ${fileChange.path}
Content with line numbers:
\`\`\`
${this.addLineNumbers(fileChange.content || "")}
\`\`\`

Respond with JSON:
{
  "issues": [
    {
      "line": number,
      "type": "error|warning", 
      "message": "Practical explanation of what's wrong and how to fix it, focusing on the solution rather than just describing the problem",
      "rule": "logic|syntax|undefined|typo"
    }
  ],
  "suggestions": [
    {
      "line": number,
      "message": "Actionable improvement suggestion with specific implementation details"
    }
  ],
  "summary": "Brief actionable summary focusing on what to do to fix the issues"
}

RESPONSE STYLE:
- Write messages as actionable instructions: "Change X to Y because Z"
- Focus on solutions, not just problem descriptions  
- Be specific about what code to modify
- Explain the reasoning for the fix
- Use practical language like "modify", "add", "remove", "replace"

EXAMPLE GOOD MESSAGE:
"Variable name 'text' should be 'context' on line 9 to match the actual variable being used in the conditional check on line 11"

EXAMPLE BAD MESSAGE:  
"Variable name mismatch detected between declaration and usage"`;
  }

  private getFileType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "TypeScript";
      case "js":
      case "jsx":
        return "JavaScript";
      case "vue":
        return "Vue";
      case "py":
        return "Python";
      case "java":
        return "Java";
      case "css":
      case "scss":
        return "CSS";
      default:
        return "code";
    }
  }

  private addLineNumbers(content: string): string {
    return content
      .split("\n")
      .map(
        (line, index) => `${(index + 1).toString().padStart(3, " ")}: ${line}`
      )
      .join("\n");
  }

  private getCacheKey(fileChange: FileChange): string {
    // Create cache key based on file path and content hash
    const crypto = require("crypto");
    const contentHash = crypto
      .createHash("md5")
      .update(fileChange.content || "")
      .digest("hex");
    return `${fileChange.path}:${contentHash}`;
  }

  private formatFileContentWithLineNumbers(content: string): string {
    this.logger.debug("Formatting file content with line numbers", {
      contentLength: content.length,
    });

    const lines = content.split("\n");
    const formattedLines = lines.map((line, index) => {
      const lineNumber = (index + 1).toString().padStart(3, " ");
      return `${lineNumber}: ${line}`;
    });

    const result = formattedLines.join("\n");
    this.logger.debug("File content formatted", {
      originalLines: lines.length,
      formattedLength: result.length,
    });

    return result;
  }

  private parseAnalysisResponse(
    response: string,
    filePath: string
  ): ReviewResult {
    this.logger.debug("Parsing Claude analysis response", { file: filePath });

    try {
      // Log the raw response for debugging
      this.logger.debug("Raw Claude response", {
        file: filePath,
        responseLength: response.length,
        responsePreview: response.substring(0, 200) + "...",
      });

      // Also log to console for immediate debugging
      console.log(
        `[ClaudeService] Raw response for ${filePath}:`,
        response.substring(0, 500)
      );

      let cleanResponse = response
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      // First try to find a complete JSON object
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }

      // Only clean problematic characters if needed, but preserve JSON structure
      if (
        cleanResponse.includes("\n") ||
        cleanResponse.includes("\r") ||
        cleanResponse.includes("\t")
      ) {
        // Only escape unescaped newlines/returns/tabs within string values
        cleanResponse = cleanResponse.replace(
          /"([^"\\]*(\\.[^"\\]*)*)"/g,
          (match) => {
            return match
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r")
              .replace(/\t/g, "\\t");
          }
        );
      }

      this.logger.debug("Cleaned response for parsing", {
        file: filePath,
        cleanResponseLength: cleanResponse.length,
        cleanResponsePreview: cleanResponse.substring(0, 200) + "...",
      });

      let parsed;
      try {
        parsed = JSON.parse(cleanResponse);
      } catch (jsonError) {
        // Log detailed error info for debugging
        console.log("[ClaudeService] JSON Parse Error Details:", {
          error:
            jsonError instanceof Error ? jsonError.message : String(jsonError),
          originalResponse: response.substring(0, 1000),
          cleanedResponse: cleanResponse.substring(0, 1000),
          responseLength: response.length,
          cleanedLength: cleanResponse.length,
        });

        // Try multiple fallback strategies
        let fallbackSuccessful = false;

        // Strategy 1: Extract just the JSON part more aggressively
        const fallbackMatch = response.match(/\{[\s\S]*"issues"[\s\S]*\}/);
        if (fallbackMatch && !fallbackSuccessful) {
          try {
            parsed = JSON.parse(fallbackMatch[0]);
            fallbackSuccessful = true;
          } catch (fallbackError) {
            console.log("[ClaudeService] Fallback 1 failed:", fallbackError);
          }
        }

        // Strategy 2: Create minimal valid response
        if (!fallbackSuccessful) {
          console.log("[ClaudeService] Using minimal fallback response");
          parsed = {
            issues: [],
            suggestions: [],
            summary: "Failed to parse Claude response - using empty result",
          };
          fallbackSuccessful = true;
        }

        if (!fallbackSuccessful) {
          throw new Error(`JSON parsing failed: ${jsonError}`);
        }
      }

      // Validate the parsed structure
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Parsed response is not an object");
      }

      const result = {
        file: filePath,
        issues: Array.isArray(parsed.issues)
          ? parsed.issues.map((issue: any) => ({
              ...issue,
              source: "claude" as const,
            }))
          : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.map((suggestion: any) => ({
              ...suggestion,
              source: "claude" as const,
            }))
          : [],
        score: typeof parsed.score === "number" ? parsed.score : 0,
        summary:
          typeof parsed.summary === "string"
            ? parsed.summary
            : "No summary provided",
      };

      this.logger.debug("Analysis response parsed successfully", {
        file: filePath,
        issuesCount: result.issues.length,
        suggestionsCount: result.suggestions.length,
        score: result.score,
        summaryLength: result.summary.length,
      });

      // Also log to console for immediate debugging
      console.log(`[ClaudeService] Parsed result for ${filePath}:`, {
        issues: result.issues,
        suggestions: result.suggestions,
        score: result.score,
        summary: result.summary,
      });

      return result;
    } catch (error) {
      this.logger.logError("Parse analysis response", {
        file: filePath,
        error: error instanceof Error ? error : new Error(String(error)),
        responseLength: response.length,
        responsePreview: response.substring(0, 500) + "...",
      });

      return {
        file: filePath,
        issues: [
          {
            type: "error",
            line: 1,
            message: `Failed to parse Claude response: ${
              error instanceof Error ? error.message : String(error)
            }`,
            source: "claude",
          },
        ],
        suggestions: [],
        score: 0,
        summary:
          "Analysis parsing failed - Claude returned invalid response format",
      };
    }
  }

  private async saveConfig(config: ClaudeConfig): Promise<void> {
    this.logger.debug("Saving Claude config");
    await this.context.secrets.store("claude-config", JSON.stringify(config));
  }

  isInitialized(): boolean {
    const initialized = !!this.anthropic;
    this.logger.debug("Checking ClaudeService initialization status", {
      initialized,
    });
    return initialized;
  }

  async hasValidConfig(): Promise<boolean> {
    this.logger.debug("Checking if ClaudeService has valid config");

    try {
      const config = await this.getConfig();
      const hasValid = !!(config && config.apiKey);
      this.logger.debug("Config validation result", { hasValid });
      return hasValid;
    } catch (error) {
      this.logger.warn("Config validation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async getConfig(): Promise<ClaudeConfig | null> {
    this.logger.debug("Getting Claude config");

    try {
      const configString = await this.context.secrets.get("claude-config");
      if (!configString) {
        this.logger.debug("No saved config found");
        return null;
      }

      const config = JSON.parse(configString);
      this.logger.debug("Config retrieved successfully");
      return config;
    } catch (error) {
      this.logger.logError(
        "Get config",
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  async analyzeCode(prompt: string): Promise<string> {
    this.logger.logServiceCall("ClaudeService", "analyzeCode", {
      promptLength: prompt.length,
    });

    if (!this.anthropic) {
      const error = "Claude not initialized. Please set API key first.";
      this.logger.error("Claude not initialized for code analysis");
      throw new Error(error);
    }

    try {
      this.logger.debug("Sending code analysis request to Claude API");

      const response = await this.anthropic.messages.create({
        model: this.currentModel,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      this.logger.debug("Claude API code analysis response received", {
        responseLength:
          response.content[0]?.type === "text"
            ? response.content[0].text.length
            : 0,
      });

      const content = response.content[0];
      if (content.type === "text") {
        this.logger.logServiceResponse("ClaudeService", "analyzeCode", {
          responseLength: content.text.length,
        });
        return content.text;
      }

      throw new Error("Invalid response format");
    } catch (error) {
      this.logger.logError("Claude code analysis", error);
      throw new Error(`Claude analysis failed: ${error}`);
    }
  }

  clearCache(): void {
    this.resultCache.clear();
    this.logger.debug("Analysis result cache cleared");
  }

  async setModel(model: ClaudeModel): Promise<void> {
    this.logger.logOperation("Setting Claude model", { model });

    this.currentModel = model;

    // Update config with new model
    const config = await this.getConfig();
    if (config) {
      await this.saveConfig({ ...config, model });
      this.logger.info("Claude model updated", { model });
    }
  }

  getCurrentModel(): ClaudeModel {
    return this.currentModel;
  }
}
