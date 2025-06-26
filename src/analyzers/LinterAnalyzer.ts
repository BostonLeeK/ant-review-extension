import * as vscode from "vscode";
import { LoggerService } from "../services/LoggerService";
import { FileChange, Issue, ReviewResult, Suggestion } from "../types";

export class LinterAnalyzer {
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
    this.logger.info("LinterAnalyzer initialized");
  }

  async analyzeFile(fileChange: FileChange): Promise<ReviewResult> {
    this.logger.logServiceCall("LinterAnalyzer", "analyzeFile", {
      file: fileChange.path,
    });

    const issues: Issue[] = [];
    const suggestions: Suggestion[] = [];

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        this.logger.warn("No workspace root found for linter analysis", {
          file: fileChange.path,
        });
        return this.createEmptyResult(fileChange.path);
      }

      const fileUri = vscode.Uri.file(`${workspaceRoot}/${fileChange.path}`);
      this.logger.debug("Getting diagnostics for file", {
        file: fileChange.path,
        workspaceRoot,
      });

      const diagnostics = vscode.languages.getDiagnostics(fileUri);
      this.logger.debug("Diagnostics retrieved", {
        file: fileChange.path,
        diagnosticsCount: diagnostics.length,
      });

      for (const diagnostic of diagnostics) {
        const issue = this.convertDiagnosticToIssue(diagnostic);
        issues.push(issue);

        if (diagnostic.severity === vscode.DiagnosticSeverity.Information) {
          const suggestion = this.createSuggestionFromDiagnostic(diagnostic);
          if (suggestion) {
            suggestions.push(suggestion);
          }
        }
      }

      const score = this.calculateScore(issues);

      const result = {
        file: fileChange.path,
        issues,
        suggestions,
        score,
        summary: this.generateSummary(issues, suggestions),
      };

      this.logger.logServiceResponse("LinterAnalyzer", "analyzeFile", {
        file: fileChange.path,
        issuesCount: issues.length,
        suggestionsCount: suggestions.length,
        score,
      });

      return result;
    } catch (error) {
      this.logger.logError("Linter file analysis", {
        file: fileChange.path,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return this.createErrorResult(fileChange.path, error);
    }
  }

  async analyzeMultipleFiles(
    fileChanges: FileChange[]
  ): Promise<ReviewResult[]> {
    this.logger.logServiceCall("LinterAnalyzer", "analyzeMultipleFiles", {
      fileCount: fileChanges.length,
    });

    const results: ReviewResult[] = [];

    for (const fileChange of fileChanges) {
      try {
        this.logger.debug("Analyzing file with linter", {
          file: fileChange.path,
        });
        const result = await this.analyzeFile(fileChange);
        results.push(result);
        this.logger.debug("Linter analysis completed", {
          file: fileChange.path,
        });
      } catch (error) {
        this.logger.logError("Multiple files linter analysis", {
          file: fileChange.path,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        results.push(this.createErrorResult(fileChange.path, error));
      }
    }

    this.logger.logServiceResponse("LinterAnalyzer", "analyzeMultipleFiles", {
      totalFiles: fileChanges.length,
      successfulAnalyses: results.filter((r) => r.score > 0).length,
    });

    return results;
  }

  private convertDiagnosticToIssue(diagnostic: vscode.Diagnostic): Issue {
    const type = this.mapSeverityToType(diagnostic.severity);

    // Fix rule parsing - handle different types of diagnostic codes
    let rule = "unknown";
    if (diagnostic.code) {
      if (typeof diagnostic.code === "string") {
        rule = diagnostic.code;
      } else if (typeof diagnostic.code === "number") {
        rule = diagnostic.code.toString();
      } else if (
        diagnostic.code &&
        typeof diagnostic.code === "object" &&
        "value" in diagnostic.code
      ) {
        rule = String(diagnostic.code.value);
      }
    }

    // Use diagnostic source if available
    if (diagnostic.source) {
      rule = `${diagnostic.source}:${rule}`;
    }

    const issue = {
      type,
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      message: diagnostic.message,
      rule: rule,
      source: "linter" as const,
    };

    this.logger.debug("Converted diagnostic to issue", {
      type,
      line: issue.line,
      rule: rule,
      message: diagnostic.message.substring(0, 50) + "...",
    });

    return issue;
  }

  private createSuggestionFromDiagnostic(
    diagnostic: vscode.Diagnostic
  ): Suggestion | null {
    if (diagnostic.severity !== vscode.DiagnosticSeverity.Information) {
      return null;
    }

    const suggestion = {
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      message: this.convertToSuggestionMessage(diagnostic.message),
      source: "linter" as const,
    };

    this.logger.debug("Created suggestion from diagnostic", {
      line: suggestion.line,
      message: suggestion.message.substring(0, 50) + "...",
    });

    return suggestion;
  }

  private mapSeverityToType(
    severity: vscode.DiagnosticSeverity
  ): "error" | "warning" | "info" {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return "error";
      case vscode.DiagnosticSeverity.Warning:
        return "warning";
      case vscode.DiagnosticSeverity.Information:
      case vscode.DiagnosticSeverity.Hint:
      default:
        return "info";
    }
  }

  private convertToSuggestionMessage(diagnosticMessage: string): string {
    const lowerMessage = diagnosticMessage.toLowerCase();

    if (lowerMessage.includes("unused")) {
      return "Consider removing unused code to improve maintainability";
    }

    if (lowerMessage.includes("deprecated")) {
      return "Consider updating to the recommended alternative";
    }

    if (lowerMessage.includes("missing")) {
      return "Consider adding the missing element for better code quality";
    }

    if (lowerMessage.includes("prefer")) {
      return "Consider using the preferred approach for consistency";
    }

    return `Consider addressing: ${diagnosticMessage}`;
  }

  private calculateScore(issues: Issue[]): number {
    this.logger.debug("Calculating linter score", {
      issuesCount: issues.length,
    });

    let score = 10;

    for (const issue of issues) {
      switch (issue.type) {
        case "error":
          score -= 2;
          break;
        case "warning":
          score -= 1;
          break;
        case "info":
          score -= 0.3;
          break;
      }
    }

    const finalScore = Math.max(0, Math.round(score * 10) / 10);
    this.logger.debug("Linter score calculated", { finalScore });
    return finalScore;
  }

  private generateSummary(issues: Issue[], suggestions: Suggestion[]): string {
    this.logger.debug("Generating linter summary", {
      issuesCount: issues.length,
      suggestionsCount: suggestions.length,
    });

    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const infoCount = issues.filter((i) => i.type === "info").length;

    let summary = `Found ${errorCount} errors, ${warningCount} warnings, and ${infoCount} info items. `;
    summary += `Generated ${suggestions.length} suggestions for improvement.`;

    if (errorCount === 0 && warningCount === 0) {
      summary = "No linting issues found - code follows style guidelines well.";
    }

    this.logger.debug("Linter summary generated", { summary });
    return summary;
  }

  private createEmptyResult(filePath: string): ReviewResult {
    this.logger.debug("Creating empty linter result", { file: filePath });

    return {
      file: filePath,
      issues: [],
      suggestions: [],
      score: 10,
      summary: "No linting analysis available",
    };
  }

  private createErrorResult(filePath: string, error: any): ReviewResult {
    this.logger.logError("Creating linter error result", {
      file: filePath,
      error: error instanceof Error ? error : new Error(String(error)),
    });

    return {
      file: filePath,
      issues: [
        {
          type: "error",
          line: 1,
          message: `Linter analysis failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          source: "linter",
        },
      ],
      suggestions: [],
      score: 0,
      summary: "Linting failed",
    };
  }

  async runESLint(fileChange: FileChange): Promise<Issue[]> {
    this.logger.logServiceCall("LinterAnalyzer", "runESLint", {
      file: fileChange.path,
    });

    const issues: Issue[] = [];

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        this.logger.warn("No workspace root found for ESLint", {
          file: fileChange.path,
        });
        return issues;
      }

      const fileUri = vscode.Uri.file(`${workspaceRoot}/${fileChange.path}`);
      const diagnostics = vscode.languages.getDiagnostics(fileUri);

      this.logger.debug("ESLint diagnostics retrieved", {
        file: fileChange.path,
        diagnosticsCount: diagnostics.length,
      });

      for (const diagnostic of diagnostics) {
        const issue = this.convertDiagnosticToIssue(diagnostic);
        issues.push(issue);
      }

      this.logger.logServiceResponse("LinterAnalyzer", "runESLint", {
        file: fileChange.path,
        issuesCount: issues.length,
      });

      return issues;
    } catch (error) {
      this.logger.logError("ESLint analysis", {
        file: fileChange.path,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return issues;
    }
  }
}
