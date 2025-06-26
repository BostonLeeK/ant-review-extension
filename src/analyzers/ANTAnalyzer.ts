import { LoggerService } from "../services/LoggerService";
import { FileChange, Issue, ReviewResult, Suggestion } from "../types";

export class ANTAnalyzer {
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
    this.logger.info("ANTAnalyzer initialized with custom analysis");
  }

  async analyzeFile(fileChange: FileChange): Promise<ReviewResult> {
    this.logger.logServiceCall("ANTAnalyzer", "analyzeFile", {
      file: fileChange.path,
    });

    const issues: Issue[] = [];
    const suggestions: Suggestion[] = [];

    if (!fileChange.content) {
      this.logger.debug("No content to analyze", { file: fileChange.path });
      return this.createEmptyResult(fileChange.path);
    }

    try {
      const content = fileChange.content ?? "";
      const lines = content.split("\n");

      this.analyzeCodeQuality(lines, issues, suggestions);
      this.analyzeSecurityIssues(lines, issues, suggestions);
      this.analyzePerformanceIssues(lines, issues, suggestions);
      this.analyzeBestPractices(lines, issues, suggestions);

      const score = this.calculateScore(issues);

      const result = {
        file: fileChange.path,
        issues,
        suggestions,
        score,
        summary: this.generateSummary(issues, suggestions),
      };

      this.logger.logServiceResponse("ANTAnalyzer", "analyzeFile", {
        file: fileChange.path,
        issuesCount: issues.length,
        suggestionsCount: suggestions.length,
        score,
      });

      return result;
    } catch (error) {
      this.logger.logError("ANTAnalyzer analysis failed", {
        file: fileChange.path,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return this.createErrorResult(fileChange.path, error);
    }
  }

  async analyzeMultipleFiles(
    fileChanges: FileChange[]
  ): Promise<ReviewResult[]> {
    this.logger.logServiceCall("ANTAnalyzer", "analyzeMultipleFiles", {
      fileCount: fileChanges.length,
    });

    const results: ReviewResult[] = [];

    for (const fileChange of fileChanges) {
      try {
        this.logger.debug("Analyzing file with ANTAnalyzer", {
          file: fileChange.path,
        });
        const result = await this.analyzeFile(fileChange);
        results.push(result);
        this.logger.debug("ANTAnalyzer analysis completed", {
          file: fileChange.path,
        });
      } catch (error) {
        this.logger.logError("Multiple files ANTAnalyzer analysis", {
          file: fileChange.path,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        results.push(this.createErrorResult(fileChange.path, error));
      }
    }

    this.logger.logServiceResponse("ANTAnalyzer", "analyzeMultipleFiles", {
      totalFiles: fileChanges.length,
      successfulAnalyses: results.filter((r) => r.score > 0).length,
    });

    return results;
  }

  private analyzeCodeQuality(
    lines: string[],
    issues: Issue[],
    suggestions: Suggestion[]
  ): void {
    this.logger.debug("Analyzing code quality");

    let currentDepth = 0;
    let maxDepth = 0;
    let functionCount = 0;
    let cyclomaticComplexity = 0;
    let longLinesCount = 0;

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // Check line length
      if (line.length > 120) {
        longLinesCount++;
        if (longLinesCount <= 3) {
          issues.push({
            type: "warning",
            line: lineNum,
            message: "Line is too long (>120 characters)",
            source: "ant",
          });
          suggestions.push({
            line: lineNum,
            message:
              "Break this line into multiple lines for better readability",
            source: "ant",
          });
        }
      }

      // Count functions
      if (
        trimmedLine.includes("function ") ||
        trimmedLine.match(/=\s*\([^)]*\)\s*=>/) ||
        trimmedLine.match(/const\s+\w+\s*=\s*\([^)]*\)\s*=>/)
      ) {
        functionCount++;
      }

      // Count complexity factors
      if (trimmedLine.includes("if ") || trimmedLine.includes("else if ")) {
        cyclomaticComplexity++;
      }
      if (trimmedLine.includes("for ") || trimmedLine.includes("while ")) {
        cyclomaticComplexity++;
      }
      if (trimmedLine.includes("&&") || trimmedLine.includes("||")) {
        cyclomaticComplexity++;
      }

      // Calculate nesting depth
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      currentDepth += openBraces - closeBraces;
      maxDepth = Math.max(maxDepth, currentDepth);
    });

    // Report complexity issues
    if (maxDepth > 5) {
      issues.push({
        type: "warning",
        line: 1,
        message: `Maximum nesting depth is ${maxDepth}, consider refactoring`,
        source: "ant",
      });
      suggestions.push({
        line: 1,
        message: "Extract deeply nested logic into separate functions",
        source: "ant",
      });
    }

    if (cyclomaticComplexity > 10) {
      issues.push({
        type: "warning",
        line: 1,
        message: `Cyclomatic complexity is ${cyclomaticComplexity}, consider simplifying`,
        source: "ant",
      });
      suggestions.push({
        line: 1,
        message: "Break down complex functions into smaller, simpler ones",
        source: "ant",
      });
    }

    if (functionCount > 15) {
      issues.push({
        type: "warning",
        line: 1,
        message: `File contains ${functionCount} functions, consider splitting`,
        source: "ant",
      });
    }
  }

  private analyzeSecurityIssues(
    lines: string[],
    issues: Issue[],
    suggestions: Suggestion[]
  ): void {
    this.logger.debug("Analyzing security issues");

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check for dangerous eval usage
      if (line.includes("eval(")) {
        issues.push({
          type: "error",
          line: lineNum,
          message: "Use of eval() is dangerous and should be avoided",
          source: "ant",
        });
        suggestions.push({
          line: lineNum,
          message:
            "Replace eval() with safer alternatives like JSON.parse() or direct function calls",
          source: "ant",
        });
      }

      // Check for innerHTML assignment
      if (line.includes("innerHTML") && line.includes("=")) {
        issues.push({
          type: "warning",
          line: lineNum,
          message:
            "Direct innerHTML assignment may lead to XSS vulnerabilities",
          source: "ant",
        });
        suggestions.push({
          line: lineNum,
          message: "Use textContent or sanitization libraries instead",
          source: "ant",
        });
      }

      // Check for hardcoded credentials
      if (
        line.match(/password|secret|key|token/i) &&
        line.includes("=") &&
        !line.includes("//")
      ) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "Potential hardcoded credential detected",
          source: "ant",
        });
        suggestions.push({
          line: lineNum,
          message:
            "Use environment variables or secure configuration management",
          source: "ant",
        });
      }
    });
  }

  private analyzePerformanceIssues(
    lines: string[],
    issues: Issue[],
    suggestions: Suggestion[]
  ): void {
    this.logger.debug("Analyzing performance issues");

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check for new Date() usage in loops
      if (line.includes("new Date()") && index > 0) {
        const previousLines = lines.slice(Math.max(0, index - 5), index);
        if (
          previousLines.some((l) => l.includes("for ") || l.includes("while "))
        ) {
          issues.push({
            type: "warning",
            line: lineNum,
            message: "new Date() in loop may cause performance issues",
            source: "ant",
          });
          suggestions.push({
            line: lineNum,
            message:
              "Move new Date() outside the loop or use performance.now() for timing",
            source: "ant",
          });
        }
      }

      // Check for console statements in production code
      if (line.includes("console.log") || line.includes("console.error")) {
        issues.push({
          type: "info",
          line: lineNum,
          message: "Console statement found",
          source: "ant",
        });
        suggestions.push({
          line: lineNum,
          message: "Remove console statements in production code",
          source: "ant",
        });
      }

      // Check for debugger statements
      if (line.includes("debugger")) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "Debugger statement found",
          source: "ant",
        });
        suggestions.push({
          line: lineNum,
          message: "Remove debugger statement before production",
          source: "ant",
        });
      }
    });
  }

  private analyzeBestPractices(
    lines: string[],
    issues: Issue[],
    suggestions: Suggestion[]
  ): void {
    this.logger.debug("Analyzing best practices");

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check for TODO/FIXME comments
      if (line.includes("TODO") || line.includes("FIXME")) {
        issues.push({
          type: "warning",
          line: lineNum,
          message: "TODO/FIXME comment found",
          source: "ant",
        });
        suggestions.push({
          line: lineNum,
          message: "Address this TODO/FIXME before merging to production",
          source: "ant",
        });
      }

      // Check for magic numbers
      const magicNumberMatch = line.match(/\b\d{3,}\b/);
      if (magicNumberMatch && !line.includes("//") && !line.includes("/*")) {
        const number = magicNumberMatch[0];
        if (parseInt(number) > 100) {
          issues.push({
            type: "info",
            line: lineNum,
            message: `Magic number ${number} found, consider using a named constant`,
            source: "ant",
          });
          suggestions.push({
            line: lineNum,
            message: "Define a constant with a descriptive name for this value",
            source: "ant",
          });
        }
      }

      // Check for empty catch blocks
      if (line.includes("catch") && line.includes("{")) {
        const nextLines = lines.slice(index + 1, index + 10);
        const hasContent = nextLines.some(
          (l) => l.trim() && !l.trim().startsWith("//")
        );
        if (!hasContent) {
          issues.push({
            type: "warning",
            line: lineNum,
            message: "Empty catch block found",
            source: "ant",
          });
          suggestions.push({
            line: lineNum,
            message: "Add proper error handling or logging in catch block",
            source: "ant",
          });
        }
      }

      // Check for unused imports (basic check)
      if (line.trim().startsWith("import ") && line.includes(" from ")) {
        const importMatch = line.match(/import\s+{([^}]+)}\s+from/);
        if (importMatch) {
          const imports = importMatch[1].split(",").map((i) => i.trim());
          const content = lines.join(" ");
          const unusedImports = imports.filter((imp) => !content.includes(imp));
          if (unusedImports.length > 0) {
            issues.push({
              type: "warning",
              line: lineNum,
              message: `Potentially unused imports: ${unusedImports.join(
                ", "
              )}`,
              source: "ant",
            });
            suggestions.push({
              line: lineNum,
              message: "Remove unused imports to clean up the code",
              source: "ant",
            });
          }
        }
      }
    });
  }

  private calculateScore(issues: Issue[]): number {
    this.logger.debug("Calculating score", { issuesCount: issues.length });

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
    this.logger.debug("Score calculated", { finalScore });
    return finalScore;
  }

  private generateSummary(issues: Issue[], suggestions: Suggestion[]): string {
    this.logger.debug("Generating summary", {
      issuesCount: issues.length,
      suggestionsCount: suggestions.length,
    });

    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const infoCount = issues.filter((i) => i.type === "info").length;

    let summary = `Custom Analysis: Found ${errorCount} errors, ${warningCount} warnings, and ${infoCount} info items. `;
    summary += `Generated ${suggestions.length} suggestions for improvement.`;

    if (errorCount === 0 && warningCount === 0) {
      summary =
        "Custom Analysis: Code quality is good with no major issues detected.";
    }

    this.logger.debug("Summary generated", { summary });
    return summary;
  }

  private createEmptyResult(filePath: string): ReviewResult {
    this.logger.debug("Creating empty result", { file: filePath });

    return {
      file: filePath,
      issues: [],
      suggestions: [],
      score: 10,
      summary: "No content to analyze",
    };
  }

  private createErrorResult(filePath: string, error: any): ReviewResult {
    this.logger.logError("Creating error result", {
      file: filePath,
      error: error instanceof Error ? error : new Error(String(error)),
    });

    return {
      file: filePath,
      issues: [
        {
          type: "error",
          line: 1,
          message: `ANTAnalyzer failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          source: "ant",
        },
      ],
      suggestions: [],
      score: 0,
      summary: "ANTAnalyzer failed",
    };
  }
}
