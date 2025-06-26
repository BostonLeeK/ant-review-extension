import { ClaudeService } from "../services/ClaudeService";
import { LoggerService } from "../services/LoggerService";
import { FileChange, Issue, ReviewResult, Suggestion } from "../types";

export class DiffAnalyzer {
  private logger: LoggerService;
  private claudeService: ClaudeService;

  constructor(logger: LoggerService, claudeService: ClaudeService) {
    this.logger = logger;
    this.claudeService = claudeService;
    this.logger.info("DiffAnalyzer initialized with lint + Claude analysis");
  }

  async analyzeDiff(fileChange: FileChange): Promise<ReviewResult> {
    this.logger.logServiceCall("DiffAnalyzer", "analyzeDiff", {
      file: fileChange.path,
    });

    const issues: Issue[] = [];
    const suggestions: Suggestion[] = [];

    if (!fileChange.diff) {
      this.logger.debug("No diff to analyze", { file: fileChange.path });
      return this.createEmptyResult(fileChange.path);
    }

    try {
      // Extract old and new content from diff
      const { oldContent, newContent } = this.extractOldAndNewContent(
        fileChange.diff
      );

      if (!newContent.trim()) {
        this.logger.debug("No new content to analyze", {
          file: fileChange.path,
        });
        return this.createEmptyResult(fileChange.path);
      }

      // Run basic lint checks on new content
      const lintResults = this.runLintChecks(newContent, fileChange.path);
      issues.push(...lintResults.issues);
      suggestions.push(...lintResults.suggestions);

      // Run Claude analysis for old vs new comparison
      if (oldContent && newContent) {
        const claudeResults = await this.runClaudeAnalysis(
          oldContent,
          newContent,
          fileChange.path
        );
        issues.push(...claudeResults.issues);
        suggestions.push(...claudeResults.suggestions);
      }

      const score = this.calculateScore(issues);

      const result = {
        file: fileChange.path,
        issues,
        suggestions,
        score,
        summary: this.generateSummary(issues, suggestions),
      };

      this.logger.logServiceResponse("DiffAnalyzer", "analyzeDiff", {
        file: fileChange.path,
        issuesCount: issues.length,
        suggestionsCount: suggestions.length,
        score,
        hasOldContent: !!oldContent,
        hasNewContent: !!newContent,
      });

      return result;
    } catch (error) {
      this.logger.logError("Diff analysis failed", {
        file: fileChange.path,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return this.createErrorResult(fileChange.path, error);
    }
  }

  private extractOldAndNewContent(diff: string): {
    oldContent: string;
    newContent: string;
  } {
    const lines = diff.split("\n");
    const oldLines: string[] = [];
    const newLines: string[] = [];

    for (const line of lines) {
      // Skip diff headers and context lines
      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@")
      ) {
        continue;
      }

      // Extract old content (lines starting with -)
      if (line.startsWith("-") && !line.startsWith("---")) {
        oldLines.push(line.substring(1));
      }
      // Extract new content (lines starting with +)
      else if (line.startsWith("+") && !line.startsWith("+++")) {
        newLines.push(line.substring(1));
      }
      // Context lines (unchanged) - add to both
      else if (line.startsWith(" ") || line === "") {
        const content = line.startsWith(" ") ? line.substring(1) : line;
        oldLines.push(content);
        newLines.push(content);
      }
    }

    return {
      oldContent: oldLines.join("\n"),
      newContent: newLines.join("\n"),
    };
  }

  private runLintChecks(
    content: string,
    filePath: string
  ): {
    issues: Issue[];
    suggestions: Suggestion[];
  } {
    this.logger.debug("Running lint checks on diff content", {
      file: filePath,
    });

    const issues: Issue[] = [];
    const suggestions: Suggestion[] = [];

    const lines = content.split("\n");

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check for console statements
      if (line.includes("console.log") || line.includes("console.error")) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "Console statement found in new code",
          source: "diff",
        });
        suggestions.push({
          line: lineNum,
          message: "Remove console statements before committing",
          source: "diff",
        });
      }

      // Check for debugger statements
      if (line.includes("debugger")) {
        issues.push({
          type: "error",
          line: lineNum,
          message: "Debugger statement found in new code",
          source: "diff",
        });
        suggestions.push({
          line: lineNum,
          message: "Remove debugger statement before committing",
          source: "diff",
        });
      }

      // Check for TODO/FIXME comments
      if (line.includes("TODO") || line.includes("FIXME")) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "TODO/FIXME comment found in new code",
          source: "diff",
        });
        suggestions.push({
          line: lineNum,
          message: "Address TODO/FIXME before committing",
          source: "diff",
        });
      }

      // Check for hardcoded credentials
      if (
        (line.includes("password") ||
          line.includes("secret") ||
          line.includes("key")) &&
        line.includes("=") &&
        !line.includes("//")
      ) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "Potential hardcoded credential in new code",
          source: "diff",
        });
        suggestions.push({
          line: lineNum,
          message: "Use environment variables instead of hardcoded credentials",
          source: "diff",
        });
      }

      // Check for long lines
      if (line.length > 120) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "Line is too long (>120 characters)",
          source: "diff",
        });
        suggestions.push({
          line: lineNum,
          message: "Break this line into multiple lines for better readability",
          source: "diff",
        });
      }

      // Check for TypeScript ignore directives
      if (line.includes("@ts-ignore") || line.includes("@ts-nocheck")) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "TypeScript ignore directive found",
          source: "diff",
        });
        suggestions.push({
          line: lineNum,
          message:
            "Consider fixing the underlying type issues instead of ignoring them",
          source: "diff",
        });
      }
    });

    return { issues, suggestions };
  }

  private async runClaudeAnalysis(
    oldContent: string,
    newContent: string,
    filePath: string
  ): Promise<{
    issues: Issue[];
    suggestions: Suggestion[];
  }> {
    this.logger.debug("Running Claude analysis for old vs new comparison", {
      file: filePath,
    });

    const issues: Issue[] = [];
    const suggestions: Suggestion[] = [];

    try {
      const prompt = this.buildComparisonPrompt(
        oldContent,
        newContent,
        filePath
      );
      const response = await this.claudeService.analyzeCode(prompt);

      if (response) {
        // Parse Claude's response for issues and suggestions
        const parsedResults = this.parseClaudeResponse(response, filePath);
        issues.push(...parsedResults.issues);
        suggestions.push(...parsedResults.suggestions);
      }

      this.logger.debug("Claude analysis completed", {
        file: filePath,
        issuesFound: issues.length,
        suggestionsFound: suggestions.length,
      });
    } catch (error) {
      this.logger.warn("Claude analysis failed", {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { issues, suggestions };
  }

  private buildComparisonPrompt(
    oldContent: string,
    newContent: string,
    filePath: string
  ): string {
    const fileExtension = filePath.split(".").pop() || "";

    return `You are a code reviewer analyzing changes in a ${fileExtension} file. 

OLD CODE:
\`\`\`${fileExtension}
${oldContent}
\`\`\`

NEW CODE:
\`\`\`${fileExtension}
${newContent}
\`\`\`

Please analyze the changes and identify:
1. Any new bugs or issues introduced
2. Potential performance problems
3. Security vulnerabilities
4. Code quality issues
5. Best practices violations
6. Suggestions for improvement

Focus on what changed and whether the changes introduce new problems or improve the code.

Respond in this format:
ISSUE: [line number]: [description]
SUGGESTION: [line number]: [description]

If no issues found, respond with: "No issues found"`;
  }

  private parseClaudeResponse(
    response: string,
    filePath: string
  ): {
    issues: Issue[];
    suggestions: Suggestion[];
  } {
    const issues: Issue[] = [];
    const suggestions: Suggestion[] = [];

    if (response.toLowerCase().includes("no issues found")) {
      return { issues, suggestions };
    }

    const lines = response.split("\n");

    for (const line of lines) {
      if (line.startsWith("ISSUE:")) {
        const match = line.match(/ISSUE:\s*(\d+):\s*(.+)/);
        if (match) {
          issues.push({
            type: "warning",
            line: parseInt(match[1]),
            message: match[2].trim(),
            source: "claude",
          });
        }
      } else if (line.startsWith("SUGGESTION:")) {
        const match = line.match(/SUGGESTION:\s*(\d+):\s*(.+)/);
        if (match) {
          suggestions.push({
            line: parseInt(match[1]),
            message: match[2].trim(),
            source: "claude",
          });
        }
      }
    }

    return { issues, suggestions };
  }

  private calculateScore(issues: Issue[]): number {
    this.logger.debug("Calculating diff analysis score", {
      issuesCount: issues.length,
    });

    let score = 10;

    for (const issue of issues) {
      switch (issue.type) {
        case "error":
          score -= 3;
          break;
        case "warning":
          score -= 1;
          break;
        case "info":
          score -= 0.5;
          break;
      }
    }

    const finalScore = Math.max(0, score);
    this.logger.debug("Diff analysis score calculated", { finalScore });
    return finalScore;
  }

  private generateSummary(issues: Issue[], suggestions: Suggestion[]): string {
    this.logger.debug("Generating diff analysis summary", {
      issuesCount: issues.length,
      suggestionsCount: suggestions.length,
    });

    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const infoCount = issues.filter((i) => i.type === "info").length;

    let summary = `Diff Analysis: Found ${errorCount} errors, ${warningCount} warnings, and ${infoCount} info items. `;
    summary += `Generated ${suggestions.length} suggestions for improvement.`;

    if (errorCount === 0 && warningCount === 0) {
      summary =
        "Diff Analysis: Changes look good with no major issues detected.";
    }

    this.logger.debug("Diff analysis summary generated", { summary });
    return summary;
  }

  private createEmptyResult(filePath: string): ReviewResult {
    this.logger.debug("Creating empty diff result", { file: filePath });

    return {
      file: filePath,
      issues: [],
      suggestions: [],
      score: 10,
      summary: "No diff content to analyze",
    };
  }

  private createErrorResult(filePath: string, error: any): ReviewResult {
    this.logger.logError("Creating diff error result", {
      file: filePath,
      error: error instanceof Error ? error : new Error(String(error)),
    });

    return {
      file: filePath,
      issues: [
        {
          type: "error",
          line: 1,
          message: `Diff analysis failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          source: "diff",
        },
      ],
      suggestions: [],
      score: 0,
      summary: "Diff analysis failed",
    };
  }
}
