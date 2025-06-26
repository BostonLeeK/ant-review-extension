import * as vscode from "vscode";
import { ANTAnalyzer } from "../analyzers/ANTAnalyzer";
import { DiffAnalyzer } from "../analyzers/DiffAnalyzer";
import { LinterAnalyzer } from "../analyzers/LinterAnalyzer";
import { ClaudeService } from "../services/ClaudeService";
import { GitService } from "../services/GitService";
import { LoggerService } from "../services/LoggerService";
import { FileChange, ReviewResult, WebviewMessage } from "../types";
import { UniversalAntReviewProvider } from "./AntCodeLensProvider";

export class CodeReviewProvider
  implements vscode.Disposable, vscode.WebviewViewProvider
{
  private panel: vscode.WebviewPanel | undefined;
  private webviewView: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private logger: LoggerService;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly gitService: GitService,
    private readonly claudeService: ClaudeService,
    private readonly antAnalyzer: ANTAnalyzer,
    private readonly diffAnalyzer: DiffAnalyzer,
    private readonly linterAnalyzer: LinterAnalyzer,
    private readonly universalAntReviewProvider: UniversalAntReviewProvider,
    logger: LoggerService
  ) {
    this.logger = logger;
    this.logger.info("CodeReviewProvider initialized");
  }

  // Implementation for WebviewViewProvider interface (sidebar)
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.logger.logOperation("Resolving webview view");

    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getWebviewContent();
    this.setupWebviewMessageHandling(webviewView.webview);
    this.loadInitialData();

    this.logger.info("Webview view resolved successfully");
  }

  public show(): void {
    this.logger.logOperation("Showing code review panel");

    if (this.panel) {
      this.panel.reveal();
      this.logger.debug("Panel already exists, revealing");
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "codeReview",
      "Ant Review",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.logger.debug("Webview panel created");

    this.panel.webview.html = this.getWebviewContent();
    this.setupWebviewMessageHandling();

    this.panel.onDidDispose(
      () => {
        this.logger.debug("Webview panel disposed");
        this.panel = undefined;
      },
      null,
      this.disposables
    );

    this.loadInitialData();
    this.logger.info("Code review panel shown successfully");
  }

  public refreshChanges(): void {
    this.logger.logOperation("Refreshing changes");

    // Clear Claude cache when refreshing
    this.claudeService.clearCache();

    if (this.panel) {
      this.loadInitialData();
    } else {
      this.logger.warn("No panel available for refresh");
    }
  }

  private setupWebviewMessageHandling(webview?: vscode.Webview): void {
    this.logger.debug("Setting up webview message handling");

    const targetWebview = webview || this.panel?.webview;
    if (!targetWebview) {
      this.logger.warn("No target webview available for message handling");
      return;
    }

    targetWebview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        this.logger.debug("Received webview message", {
          command: message.command,
        });

        switch (message.command) {
          case "setApiKey":
            await this.handleSetApiKey(message.data.apiKey);
            break;
          case "setModel":
            await this.handleSetModel(message.data.model);
            break;
          case "analyzeFiles":
            await this.handleAnalyzeFiles(message.data.fileChanges);
            break;
          case "analyzeFullFile":
            await this.handleAnalyzeFullFile(message.data.filePath);
            break;

          case "refreshChanges":
            await this.loadInitialData();
            break;
          case "openFile":
            await this.handleOpenFile(message.data.filePath, message.data.line);
            break;
          case "showApiKeyInfo":
            await this.handleShowApiKeyInfo();
            break;
          case "analyzeLastCommit":
            console.log("📨 Received analyzeLastCommit message");
            await this.handleAnalyzeLastCommit();
            break;
          default:
            this.logger.warn("Unknown webview message command", {
              command: message.command,
            });
        }
      },
      undefined,
      this.disposables
    );

    this.logger.debug("Webview message handling setup completed");
  }

  private async loadInitialData(): Promise<void> {
    this.logger.logOperation("Loading initial data");

    try {
      this.sendToWebview("loadingStarted", {});
      this.logger.debug("Loading started notification sent");

      await this.claudeService.waitForInitialization();
      this.logger.debug("Claude service initialization completed");

      const changes = await this.gitService.getFreshChanges();
      this.logger.debug("Fresh git changes retrieved", {
        changesCount: changes.length,
      });

      const hasValidConfig = await this.claudeService.hasValidConfig();
      const config = await this.claudeService.getConfig();
      this.logger.debug("Claude config status", {
        hasValidConfig,
        hasConfig: !!config,
      });

      const currentBranch = await this.gitService.getCurrentBranch();
      const baseBranch = await this.gitService.getBaseBranch();
      this.logger.debug("Branch information retrieved", {
        currentBranch,
        baseBranch,
      });

      let maskedApiKey = "";
      if (config && config.apiKey) {
        maskedApiKey =
          config.apiKey.substring(0, 8) +
          "..." +
          config.apiKey.substring(config.apiKey.length - 4);
      }

      this.sendToWebview("dataLoaded", {
        changes,
        claudeConfigured: hasValidConfig && this.claudeService.isInitialized(),
        maskedApiKey: maskedApiKey,
        currentModel: this.claudeService.getCurrentModel(),
      });

      this.sendToWebview("branchInfo", {
        currentBranch,
        baseBranch,
      });

      this.logger.info("Initial data loaded successfully", {
        changesCount: changes.length,
        claudeConfigured: hasValidConfig && this.claudeService.isInitialized(),
      });
    } catch (error) {
      this.logger.logError("Load initial data", error);
      vscode.window.showErrorMessage(`Failed to load changes: ${error}`);
      this.sendToWebview("loadingError", { error: String(error) });
    }
  }

  private async handleSetApiKey(apiKey: string): Promise<void> {
    this.logger.logOperation("Setting API key", { hasApiKey: !!apiKey });

    try {
      await this.claudeService.initialize(apiKey);
      vscode.window.showInformationMessage(
        "Claude API key configured successfully"
      );

      this.sendToWebview("apiKeySet", { success: true });
      this.logger.info("API key set successfully");
    } catch (error) {
      this.logger.logError("Set API key", error);
      vscode.window.showErrorMessage(`Failed to configure Claude: ${error}`);
      this.sendToWebview("apiKeySet", {
        success: false,
        error: String(error),
      });
    }
  }

  private async handleSetModel(model: string): Promise<void> {
    this.logger.logOperation("Setting Claude model", { model });

    try {
      await this.claudeService.setModel(model as any);
      const modelName = model.includes("sonnet")
        ? "Claude 3.5 Sonnet"
        : "Claude 3 Haiku";

      vscode.window.showInformationMessage(
        `Claude model changed to ${modelName}`
      );

      // Clear cache when changing models
      this.claudeService.clearCache();

      this.sendToWebview("modelSet", {
        success: true,
        model,
        modelName,
      });
      this.logger.info("Model set successfully", { model });
    } catch (error) {
      this.logger.logError("Set model", error);
      vscode.window.showErrorMessage(`Failed to set Claude model: ${error}`);
      this.sendToWebview("modelSet", {
        success: false,
        error: String(error),
      });
    }
  }

  private async handleAnalyzeFiles(fileChanges: FileChange[]): Promise<void> {
    this.logger.logOperation("Analyzing files", {
      fileCount: fileChanges.length,
    });

    if (!this.claudeService.isInitialized()) {
      this.logger.warn("Claude service not initialized for file analysis");
      vscode.window.showWarningMessage("Please configure Claude API key first");
      return;
    }

    this.sendToWebview("analysisStarted", { fileCount: fileChanges.length });
    this.logger.debug("Analysis started notification sent");

    // Clear cache to ensure fresh analysis
    this.claudeService.clearCache();

    try {
      // Get fresh file changes to ensure we have the latest content
      const freshChanges = await this.gitService.getFreshChanges();
      const results: ReviewResult[] = [];

      for (const originalFileChange of fileChanges) {
        // Find the fresh version of this file or use the original if not found
        const fileChange =
          freshChanges.find((fc) => fc.path === originalFileChange.path) ||
          originalFileChange;

        this.logger.debug("Analyzing full file", {
          file: fileChange.path,
          usingFreshData: freshChanges.some(
            (fc) => fc.path === originalFileChange.path
          ),
        });

        const [claudeResult, antResult, linterResult] = await Promise.all([
          this.claudeService.analyzeFile(fileChange),
          this.antAnalyzer.analyzeFile(fileChange),
          this.linterAnalyzer.analyzeFile(fileChange),
        ]);

        // Log individual analyzer results
        this.logger.debug("Individual analyzer results", {
          file: fileChange.path,
          claudeIssues: claudeResult.issues.length,
          claudeSuggestions: claudeResult.suggestions.length,
          claudeScore: claudeResult.score,
          antIssues: antResult.issues.length,
          antSuggestions: antResult.suggestions.length,
          antScore: antResult.score,
          linterIssues: linterResult.issues.length,
          linterSuggestions: linterResult.suggestions.length,
          linterScore: linterResult.score,
        });

        // Log to console for immediate debugging
        console.log(
          `[CodeReviewProvider] Individual analyzer results for ${fileChange.path}:`,
          {
            claude: {
              issues: claudeResult.issues,
              suggestions: claudeResult.suggestions,
              score: claudeResult.score,
            },
            ant: {
              issues: antResult.issues,
              suggestions: antResult.suggestions,
              score: antResult.score,
            },
            linter: {
              issues: linterResult.issues,
              suggestions: linterResult.suggestions,
              score: linterResult.score,
            },
          }
        );

        // Log ANTAnalyzer issues in detail
        if (antResult.issues.length > 0) {
          this.logger.debug("ANTAnalyzer issues found", {
            file: fileChange.path,
            issues: antResult.issues.map((issue) => ({
              type: issue.type,
              line: issue.line,
              message: issue.message,
              source: issue.source,
            })),
          });
        }

        const combinedResult = this.combineResults([
          claudeResult,
          antResult,
          linterResult,
        ]);
        results.push(combinedResult);

        // Log combined result to console
        console.log(
          `[CodeReviewProvider] Combined result for ${fileChange.path}:`,
          {
            totalIssues: combinedResult.issues.length,
            totalSuggestions: combinedResult.suggestions.length,
            score: combinedResult.score,
            issues: combinedResult.issues,
            suggestions: combinedResult.suggestions,
          }
        );

        // Update decorations with all issues - use full path
        const workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const fullPath = workspaceRoot
          ? `${workspaceRoot}/${fileChange.path}`
          : fileChange.path;

        this.logger.debug("Updating decorations", {
          relativePath: fileChange.path,
          fullPath: fullPath,
          issuesCount: combinedResult.issues.length,
        });

        this.universalAntReviewProvider.setIssues(
          fullPath,
          combinedResult.issues
        );
        this.universalAntReviewProvider.setIssues(
          fileChange.path,
          combinedResult.issues
        );

        this.sendToWebview("fileAnalyzed", {
          file: fileChange.path,
          result: combinedResult,
        });

        this.logger.debug("Full file analysis completed", {
          file: fileChange.path,
          totalIssues: combinedResult.issues.length,
          totalSuggestions: combinedResult.suggestions.length,
        });
      }

      this.sendToWebview("analysisCompleted", { results });
      this.logger.info("All files analysis completed", {
        totalFiles: fileChanges.length,
        totalResults: results.length,
      });
    } catch (error) {
      this.logger.logError("Analyze files", error);
      vscode.window.showErrorMessage(`Analysis failed: ${error}`);
      this.sendToWebview("analysisError", { error: String(error) });
    }
  }

  private async handleAnalyzeFullFile(filePath: string): Promise<void> {
    this.logger.logOperation("Analyzing full file", { filePath });

    if (!this.claudeService.isInitialized()) {
      this.logger.warn("Claude service not initialized for full file analysis");
      vscode.window.showWarningMessage("Please configure Claude API key first");
      return;
    }

    try {
      // Try to get fresh changes first
      const changes = await this.gitService.getFreshChanges();
      let fileChange = changes.find((c) => c.path === filePath);

      // If file not found in changes, get it directly
      if (!fileChange) {
        this.logger.debug("File not found in changes, getting directly", {
          filePath,
        });
        fileChange = await this.gitService.getFileAsChange(filePath);
      }

      this.logger.debug("File found, proceeding with full file analysis", {
        filePath,
        fromChanges: changes.some((c) => c.path === filePath),
      });

      this.sendToWebview("analysisStarted", { fileCount: 1 });
      this.logger.debug("Full file analysis started notification sent");

      // Clear cache to ensure fresh analysis
      this.claudeService.clearCache();

      const [claudeResult, antResult, linterResult] = await Promise.all([
        this.claudeService.analyzeFullFile(fileChange),
        this.antAnalyzer.analyzeFile(fileChange),
        this.linterAnalyzer.analyzeFile(fileChange),
      ]);

      const combinedResult = this.combineResults([
        claudeResult,
        antResult,
        linterResult,
      ]);

      // Update decorations with all issues - use full path
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const fullPath = workspaceRoot
        ? `${workspaceRoot}/${fileChange.path}`
        : fileChange.path;

      this.logger.debug("Updating decorations", {
        relativePath: fileChange.path,
        fullPath: fullPath,
        issuesCount: combinedResult.issues.length,
      });

      this.universalAntReviewProvider.setIssues(
        fullPath,
        combinedResult.issues
      );
      this.universalAntReviewProvider.setIssues(
        fileChange.path,
        combinedResult.issues
      );

      this.sendToWebview("fileAnalyzed", {
        file: fileChange.path,
        result: combinedResult,
      });

      this.sendToWebview("analysisCompleted", { results: [combinedResult] });
      this.logger.info("Full file analysis completed", {
        file: fileChange.path,
        totalIssues: combinedResult.issues.length,
        totalSuggestions: combinedResult.suggestions.length,
      });
    } catch (error) {
      this.logger.logError("Analyze full file", {
        filePath,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      vscode.window.showErrorMessage(`Failed to analyze file: ${error}`);
      this.sendToWebview("analysisError", { error: String(error) });
    }
  }

  private async handleOpenFile(filePath: string, line?: number): Promise<void> {
    this.logger.logOperation("Opening file", { filePath, line });

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        this.logger.warn("No workspace root found for opening file", {
          filePath,
        });
        return;
      }

      const fileUri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
      const document = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(document);

      if (line && line > 0) {
        const position = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
        this.logger.debug("File opened at specific line", { filePath, line });
      } else {
        this.logger.debug("File opened", { filePath });
      }
    } catch (error) {
      this.logger.logError("Open file", {
        filePath,
        line,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  private async handleShowApiKeyInfo(): Promise<void> {
    this.logger.logOperation("Showing API key info");

    try {
      const config = await this.claudeService.getConfig();
      if (config && config.apiKey) {
        const maskedKey =
          config.apiKey.substring(0, 8) +
          "..." +
          config.apiKey.substring(config.apiKey.length - 4);
        vscode.window.showInformationMessage(`Claude API Key: ${maskedKey}`);
        this.logger.debug("API key info shown", { maskedKey });
      } else {
        this.logger.warn("No API key configured");
        vscode.window.showWarningMessage("No Claude API key configured");
      }
    } catch (error) {
      this.logger.logError("Show API key info", error);
      vscode.window.showErrorMessage(`Failed to get API key info: ${error}`);
    }
  }

  private async handleAnalyzeLastCommit(): Promise<void> {
    this.logger.logServiceCall("CodeReviewProvider", "handleAnalyzeLastCommit");
    console.log("🔍 Starting last commit analysis...");

    this.sendToWebview("analysisStarted", {});

    try {
      // Get last commit changes
      console.log("📦 Getting last commit changes...");
      const commitInfo = await this.gitService.getLastCommitChanges();
      console.log("📦 Commit info received:", {
        hash: commitInfo.commitHash.substring(0, 8),
        fileCount: commitInfo.changes.length,
        author: commitInfo.author,
      });

      if (commitInfo.changes.length === 0) {
        console.log("❌ No files changed in last commit");
        this.sendToWebview("analysisError", {
          error: "No files changed in the last commit",
        });
        return;
      }

      this.logger.debug("Last commit info", {
        commitHash: commitInfo.commitHash.substring(0, 8),
        fileCount: commitInfo.changes.length,
        author: commitInfo.author,
        message: commitInfo.commitMessage.substring(0, 50),
      });

      // Send commit info to webview
      console.log("📤 Sending commit info to webview...");
      this.sendToWebview("commitInfo", {
        commitHash: commitInfo.commitHash.substring(0, 8),
        commitMessage: commitInfo.commitMessage,
        author: commitInfo.author,
        date: commitInfo.date,
        fileCount: commitInfo.changes.length,
      });

      this.sendToWebview("fileAnalyzed", {});

      // Check if Claude is configured
      if (!this.claudeService.isInitialized()) {
        console.log("❌ Claude not initialized");
        this.sendToWebview("analysisError", {
          error: "Claude API not configured. Please set your API key first.",
        });
        return;
      }

      console.log(
        "🤖 Starting Claude analysis for",
        commitInfo.changes.length,
        "files..."
      );

      // Analyze files with Claude
      const claudeResults: ReviewResult[] = [];

      for (const fileChange of commitInfo.changes) {
        try {
          console.log("🔍 Analyzing file:", fileChange.path);
          const result = await this.claudeService.analyzeFullFile(fileChange);
          claudeResults.push(result);
          console.log(
            "✅ Claude analyzed file:",
            fileChange.path,
            "- found",
            result.issues.length,
            "issues"
          );
          this.logger.debug("Claude analyzed commit file", {
            file: fileChange.path,
            issueCount: result.issues.length,
          });
        } catch (error) {
          console.log("❌ Failed to analyze file:", fileChange.path, error);
          this.logger.warn("Failed to analyze commit file with Claude", {
            file: fileChange.path,
            error: error instanceof Error ? error.message : String(error),
          });
          // Add error result
          claudeResults.push({
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

      console.log(
        "🔄 Processing results from",
        claudeResults.length,
        "files..."
      );

      // For last commit analysis, show individual file results instead of combining
      console.log("✅ Sending individual file results:", {
        fileCount: claudeResults.length,
        totalIssues: claudeResults.reduce((sum, r) => sum + r.issues.length, 0),
        totalSuggestions: claudeResults.reduce(
          (sum, r) => sum + r.suggestions.length,
          0
        ),
      });

      this.sendToWebview("analysisCompleted", {
        results: claudeResults,
        commitInfo: {
          commitHash: commitInfo.commitHash.substring(0, 8),
          commitMessage: commitInfo.commitMessage,
          author: commitInfo.author,
          date: commitInfo.date,
        },
      });

      this.logger.logServiceResponse(
        "CodeReviewProvider",
        "handleAnalyzeLastCommit",
        {
          commitHash: commitInfo.commitHash.substring(0, 8),
          fileCount: commitInfo.changes.length,
          totalIssues: claudeResults.reduce(
            (sum, r) => sum + r.issues.length,
            0
          ),
        }
      );

      console.log("🎉 Last commit analysis completed successfully!");
    } catch (error) {
      console.log("💥 Error during last commit analysis:", error);
      this.logger.logError("handleAnalyzeLastCommit", error);
      this.sendToWebview("analysisError", {
        error: `Failed to analyze last commit: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  private combineResults(results: ReviewResult[]): ReviewResult {
    this.logger.debug("Combining analysis results", {
      resultsCount: results.length,
    });

    const combined: ReviewResult = {
      file: results[0]?.file || "Unknown file",
      issues: [],
      suggestions: [],
      score: 0,
      summary: "",
    };

    results.forEach((result, index) => {
      this.logger.debug(`Processing result ${index}`, {
        source: result.issues[0]?.source || "unknown",
        totalIssues: result.issues.length,
        issuesByType: {
          error: result.issues.filter((i) => i.type === "error").length,
          warning: result.issues.filter((i) => i.type === "warning").length,
          info: result.issues.filter((i) => i.type === "info").length,
        },
        suggestions: result.suggestions.length,
        score: result.score,
      });

      // Include all issues (error, warning, and info)
      combined.issues.push(...result.issues);
      combined.suggestions.push(...result.suggestions);
    });

    combined.score =
      Math.round(
        (results.reduce((sum, r) => sum + r.score, 0) / results.length) * 10
      ) / 10;

    const summaries = results.map((r) => r.summary).filter((s) => s);
    combined.summary = summaries.join(" | ");

    this.logger.debug("Results combined", {
      file: combined.file,
      totalIssues: combined.issues.length,
      totalSuggestions: combined.suggestions.length,
      score: combined.score,
      issuesByType: {
        error: combined.issues.filter((i) => i.type === "error").length,
        warning: combined.issues.filter((i) => i.type === "warning").length,
        info: combined.issues.filter((i) => i.type === "info").length,
      },
    });

    return combined;
  }

  private sendToWebview(command: string, data?: any): void {
    this.logger.debug("Sending message to webview", {
      command,
      dataKeys: data ? Object.keys(data) : [],
    });

    const message = { command, data };

    try {
      if (this.panel) {
        this.panel.webview.postMessage(message);
        this.logger.debug("Message sent to panel webview");
      }

      if (this.webviewView) {
        this.webviewView.webview.postMessage(message);
        this.logger.debug("Message sent to sidebar webview");
      }

      if (!this.panel && !this.webviewView) {
        this.logger.warn("No webview available to send message to", {
          command,
        });
      }
    } catch (error) {
      this.logger.logError("Failed to send message to webview", error);
    }
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ant Review Assistant</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 0;
            background: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
            overflow-x: hidden;
        }
        
        .ai-review-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-sideBar-background);
        }
        
        .logo {
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 1.2px;
            color: var(--vscode-foreground);
        }
        
        .header-icons {
            display: flex;
            gap: 8px;
        }
        
        .icon-btn {
            background: none;
            border: none;
            color: var(--vscode-icon-foreground);
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            font-size: 16px;
        }
        
        .icon-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        
        .section {
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: var(--vscode-sideBar-background);
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--vscode-foreground);
            cursor: pointer;
            user-select: none;
        }
        
        .section-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .expand-icon {
            transition: transform 0.2s;
        }
        
        .expand-icon.expanded {
            transform: rotate(90deg);
        }
        
        .section-content {
            background: var(--vscode-editor-background);
            max-height: 400px;
            overflow-y: auto;
        }

        .section-content.collapsible {
            max-height: 400px;
            overflow-y: auto;
        }

        .section-content.collapsed {
            max-height: 0 !important;
            overflow: hidden;
        }

        /* Custom scrollbar styles for better VS Code integration */
        .section-content::-webkit-scrollbar {
            width: 8px;
        }

        .section-content::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }

        .section-content::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }

        .section-content::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }

        .section-content::-webkit-scrollbar-thumb:active {
            background: var(--vscode-scrollbarSlider-activeBackground);
        }
        
        .error-message {
            padding: 16px;
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            margin: 8px;
            text-align: center;
        }
        
        .new-review {
            padding: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        .branch-tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            max-width: 120px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .arrow {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        
        .files-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: var(--vscode-sideBar-background);
        }
        
        .files-count {
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--vscode-foreground);
        }
        
        .action-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
            font-weight: 500;
        }
        
        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .action-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .action-btn.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .progress-item {
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--vscode-foreground);
            font-size: 12px;
            background: var(--vscode-editor-background);
        }
        
        .progress-icon {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        
        .progress-icon.completed {
            background: var(--vscode-testing-iconPassed);
        }
        
        .progress-icon.current {
            background: var(--vscode-progressBar-background);
            animation: pulse 1.5s infinite;
        }
        
        .progress-icon.pending {
            background: var(--vscode-descriptionForeground);
            opacity: 0.3;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .file-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            transition: background-color 0.1s;
        }
        
        .file-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .file-item:last-child {
            border-bottom: none;
        }
        
        .file-icon {
            margin-right: 12px;
            font-size: 16px;
            width: 16px;
            text-align: center;
            flex-shrink: 0;
        }
        
        .file-info {
            flex: 1;
            min-width: 0;
        }
        
        .file-name {
            font-size: 13px;
            color: var(--vscode-foreground);
            margin-bottom: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .file-status {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        .file-status.under-review {
            color: var(--vscode-progressBar-background);
        }
        
        .file-actions {
            display: flex;
            gap: 6px;
            margin-left: 8px;
        }
        
        .action-btn.small {
            padding: 4px 8px;
            font-size: 10px;
            min-width: 60px;
        }
        
        .review-comment {
            padding: 16px;
            background: var(--vscode-editor-background);
            border-left: 3px solid var(--vscode-progressBar-background);
            margin: 0;
        }
        
        .comment-text {
            font-size: 13px;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
            line-height: 1.4;
        }
        
        .comment-tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
        }
        
        .api-key-section {
            padding: 24px 16px;
            text-align: center;
            background: var(--vscode-editor-background);
        }
        
        .api-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        
        .api-subtitle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 16px;
        }
        
        .api-input {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 10px 12px;
            border-radius: 4px;
            width: 100%;
            max-width: 280px;
            margin-bottom: 12px;
            font-size: 13px;
        }
        
        .api-input:focus {
            border-color: var(--vscode-focusBorder);
            outline: none;
        }
        
        .api-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            font-weight: 500;
        }
        
        .api-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .api-status {
            margin-top: 12px;
            font-size: 12px;
        }

        .model-selection {
            margin-top: 16px;
            margin-bottom: 8px;
        }

        .model-selection label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .model-select {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 12px;
            font-family: inherit;
        }

        .model-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }

        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .close-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 18px;
            cursor: pointer;
            padding: 8px;
            border-radius: 4px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }

        .close-btn:hover {
            opacity: 1;
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .settings-footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .secondary-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .secondary-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .commit-info {
            padding: 16px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            margin: 8px;
        }

        .commit-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .commit-hash {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
        }

        .commit-author {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        .commit-message {
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
            line-height: 1.4;
        }

        .commit-stats {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        
        .loading {
            text-align: center;
            padding: 40px 16px;
            background: var(--vscode-editor-background);
        }
        
        .loading-spinner {
            width: 24px;
            height: 24px;
            border: 2px solid var(--vscode-panel-border);
            border-top: 2px solid var(--vscode-progressBar-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .loading-text {
            color: var(--vscode-foreground);
            font-size: 13px;
            margin-bottom: 8px;
            font-weight: 500;
        }
        
        .loading-subtext {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        
        .hidden { 
            display: none; 
        }
        
        .collapsible {
            overflow: hidden;
            transition: max-height 0.3s ease-out;
        }
        
        .collapsed {
            max-height: 0 !important;
        }

        .file-results-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.1s;
        }

        .file-results-header:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .file-results-header:last-child {
            border-bottom: none;
        }

        .file-results-info {
            display: flex;
            align-items: center;
            flex: 1;
        }

        .file-results-counts {
            display: flex;
            gap: 8px;
            margin-left: 12px;
        }

        .count-badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 10px;
            font-weight: 500;
        }

        .count-badge.error {
            background: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .count-badge.warning {
            background: #ffa500;
            color: #000000;
        }

        .count-badge.info {
            background: #0066cc;
            color: #ffffff;
        }

        .file-results-content {
            background: var(--vscode-sideBar-background);
        }

        .file-results-toggle {
            color: var(--vscode-icon-foreground);
            font-size: 12px;
            transition: transform 0.2s;
            margin-left: 8px;
        }

        .file-results-toggle.expanded {
            transform: rotate(90deg);
        }

        .file-section {
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .file-section:last-child {
            border-bottom: none;
        }

        .comment-tag.error {
            background: #d73a49;
            color: #ffffff;
        }

        .comment-tag.warning {
            background: #ffa500;
            color: #000000;
        }

        .comment-tag.info {
            background: #0066cc;
            color: #ffffff;
        }

        .comment-tag.suggestion {
            background: #28a745;
            color: #ffffff;
        }

        .file-results-header .file-info {
            flex: 1;
            min-width: 0;
            margin-left: 8px;
        }

        .file-results-header .file-name {
            font-size: 13px;
            color: var(--vscode-foreground);
            margin-bottom: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .file-results-header .file-status {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .suggestion-toggle {
            margin-top: 4px;
        }

        .suggestion-btn {
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            transition: background-color 0.1s;
        }

        .suggestion-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .suggestion-btn.showing {
            color: var(--vscode-foreground);
        }

        .suggestion-item.hidden {
            display: none;
        }

        .suggestions-container.hidden {
            display: none;
        }

        .suggestions-header .comment-text {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .review-comment {
            padding: 12px 16px;
            background: var(--vscode-editor-background);
            border-left: 3px solid var(--vscode-progressBar-background);
            margin: 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .review-comment:last-child {
            border-bottom: none;
        }
    </style>
</head>
<body>
    <!-- Header -->
    <div class="ai-review-header">
        <div class="logo">ANT - REVIEW ASSISTANT</div>
        <div class="header-icons">
            <button class="icon-btn" onclick="showSettings()" title="Settings">⚙️</button>
            <button class="icon-btn" onclick="showApiKeyInfo()" title="API Key Info">🔑</button>
        </div>
    </div>

    <!-- Loading Section -->
    <div id="loadingSection" class="loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">Initializing Ant Review Assistant</div>
        <div class="loading-subtext">Loading configuration and checking API key...</div>
    </div>

    <!-- API Key Configuration -->
    <div id="apiKeySection" class="api-key-section hidden">
        <div class="settings-header">
            <div class="api-title">Configure Claude API Key</div>
            <button onclick="closeSettings()" class="close-btn">✕</button>
        </div>
        <div class="api-subtitle">Enter your Anthropic Claude API key to start analyzing code</div>
        <input type="password" id="apiKeyInput" class="api-input" placeholder="sk-ant-api03-...">
        <br>
        <button onclick="setApiKey()" class="api-btn">Set API Key</button>
        <div class="model-selection">
            <label for="modelSelect">Claude Model:</label>
            <select id="modelSelect" class="model-select" onchange="setModel()">
                <option value="claude-3-7-sonnet-20250219">Claude 3.7 Sonnet (Extended Thinking)</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Smart & Accurate)</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast & Cheap)</option>
                <option value="claude-3-haiku-20240307">Claude 3 Haiku (Legacy Fast)</option>
            </select>
        </div>
        <div id="apiKeyStatus" class="api-status"></div>
        <div class="settings-footer">
            <button onclick="closeSettings()" class="secondary-btn">Done</button>
        </div>
    </div>

    <!-- New Review Section -->
    <div id="newReviewSection" class="section hidden">
        <div class="section-header">
            <span>NEW REVIEW</span>
        </div>
        <div class="section-content">
            <div class="new-review">
                <span class="branch-tag" id="currentBranch">main</span>
                <span class="arrow">←</span>
                <span class="branch-tag" id="targetBranch">feature/updates</span>
            </div>
        </div>
    </div>

    <!-- Last Commit Review Section -->
    <div id="lastCommitSection" class="section">
        <div class="section-header" onclick="toggleSection('lastCommit')">
            <span>LAST COMMIT REVIEW</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="action-btn primary" onclick="analyzeLastCommit()">🔍 Review Last Commit</button>
                <span class="expand-icon" id="lastCommitIcon">▶</span>
            </div>
        </div>
        <div id="lastCommitContent" class="section-content collapsible collapsed">
            <div id="commitInfo" class="commit-info hidden">
                <div class="commit-header">
                    <div class="commit-hash" id="commitHash"></div>
                    <div class="commit-author" id="commitAuthor"></div>
                </div>
                <div class="commit-message" id="commitMessage"></div>
                <div class="commit-stats">
                    <span id="commitDate"></span> • <span id="commitFileCount"></span> files changed
                </div>
            </div>
        </div>
    </div>

    <!-- Files to Review Section -->
    <div id="filesToReviewSection" class="section hidden">
        <div class="section-header" onclick="toggleSection('filesToReview')">
            <span>FILES TO REVIEW (<span id="filesCount">0</span>)</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="action-btn" onclick="refreshChanges()">Refresh</button>
                <button class="action-btn primary" onclick="analyzeAllFiles()">Analyze All Files</button>
                <span class="expand-icon" id="filesToReviewIcon">▶</span>
            </div>
        </div>
        <div id="filesToReviewContent" class="section-content collapsible collapsed">
            <div id="fileTree"></div>
        </div>
    </div>

    <!-- Reviews Section -->
    <div id="reviewsSection" class="section hidden">
        <div class="section-header" onclick="toggleSection('reviews')">
            <span>ANALYSIS PROGRESS</span>
            <span class="expand-icon expanded" id="reviewsIcon">▶</span>
        </div>
        <div id="reviewsContent" class="section-content collapsible">
            <div id="progressItems">
                <div class="progress-item">
                    <div class="progress-icon pending"></div>
                    <span>Setting up</span>
                </div>
                <div class="progress-item">
                    <div class="progress-icon pending"></div>
                    <span>Analyzing changes</span>
                </div>
                <div class="progress-item">
                    <div class="progress-icon pending"></div>
                    <span>Reviewing files</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Analysis Results -->
    <div id="resultsSection" class="section hidden">
        <div class="section-header" onclick="toggleSection('results')">
            <span>ANALYSIS RESULTS</span>
            <span class="expand-icon expanded" id="resultsIcon">▶</span>
        </div>
        <div id="resultsContent" class="section-content collapsible">
            <div id="results"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentChanges = [];

        // Handle ESC key to close settings
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                const apiKeySection = document.getElementById('apiKeySection');
                if (apiKeySection && !apiKeySection.classList.contains('hidden')) {
                    closeSettings();
                }
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'loadingStarted':
                    handleLoadingStarted();
                    break;
                case 'dataLoaded':
                    handleDataLoaded(message.data);
                    break;
                case 'loadingError':
                    handleLoadingError(message.data);
                    break;
                case 'apiKeySet':
                    handleApiKeySet(message.data);
                    break;
                case 'analysisStarted':
                    handleAnalysisStarted(message.data);
                    break;
                case 'fileAnalyzed':
                    handleFileAnalyzed(message.data);
                    break;
                case 'analysisCompleted':
                    handleAnalysisCompleted(message.data);
                    break;
                case 'analysisError':
                    handleAnalysisError(message.data);
                    break;
                case 'branchInfo':
                    updateBranchInfo(message.data.currentBranch, message.data.baseBranch);
                    break;
                case 'modelSet':
                    handleModelSet(message.data);
                    break;
                case 'commitInfo':
                    handleCommitInfo(message.data);
                    break;
            }
        });

        function setApiKey() {
            const apiKey = document.getElementById('apiKeyInput').value;
            if (apiKey) {
                vscode.postMessage({
                    command: 'setApiKey',
                    data: { apiKey }
                });
            }
        }

        function setModel() {
            const model = document.getElementById('modelSelect').value;
            vscode.postMessage({
                command: 'setModel',
                data: { model }
            });
        }

        function closeSettings() {
            document.getElementById('apiKeySection').classList.add('hidden');
            showMainInterface();
        }

        function refreshChanges() {
            vscode.postMessage({ command: 'refreshChanges' });
        }

        function analyzeAllFiles() {
            vscode.postMessage({
                command: 'analyzeFiles',
                data: { fileChanges: currentChanges }
            });
        }

        function analyzeLastCommit() {
            console.log("🖱️ Last commit button clicked");
            vscode.postMessage({
                command: 'analyzeLastCommit'
            });
            console.log("📤 Sent analyzeLastCommit message to backend");
        }

        function openFile(filePath, line) {
            vscode.postMessage({
                command: 'openFile',
                data: { filePath, line }
            });
        }

        function showSettings() {
            // Hide all main sections and show API key section
            hideAllSections();
            document.getElementById('apiKeySection').classList.remove('hidden');
        }

        function showApiKeyInfo() {
            vscode.postMessage({ command: 'showApiKeyInfo' });
        }

        function updateBranchInfo(currentBranch, baseBranch) {
            document.getElementById('currentBranch').textContent = baseBranch || 'main';
            document.getElementById('targetBranch').textContent = currentBranch || 'working';
        }

        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId + 'Content');
            const icon = document.getElementById(sectionId + 'Icon');
            
            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                // Remove max-height limit for expanded content to allow scrolling
                content.style.maxHeight = '400px';
                icon.classList.add('expanded');
            } else {
                content.classList.add('collapsed');
                content.style.maxHeight = '0px';
                icon.classList.remove('expanded');
            }
        }

        function getFileIcon(fileName) {
            const ext = fileName.split('.').pop().toLowerCase();
            switch (ext) {
                case 'ts': case 'tsx': return '🔷';
                case 'js': case 'jsx': return '📄';
                case 'json': return '📋';
                case 'md': return '📝';
                case 'yml': case 'yaml': return '⚙️';
                case 'css': case 'scss': return '🎨';
                case 'html': return '🌐';
                case 'py': return '🐍';
                default: return '📄';
            }
        }

        function updateProgressSteps(currentStep) {
            const progressItems = document.querySelectorAll('.progress-item');
            progressItems.forEach((item, index) => {
                const icon = item.querySelector('.progress-icon');
                if (index < currentStep) {
                    icon.className = 'progress-icon completed';
                } else if (index === currentStep) {
                    icon.className = 'progress-icon current';
                } else {
                    icon.className = 'progress-icon pending';
                }
            });
        }

        function handleLoadingStarted() {
            document.getElementById('loadingSection').classList.remove('hidden');
            document.getElementById('apiKeySection').classList.add('hidden');
            hideAllSections();
        }

        function handleLoadingError(data) {
            document.getElementById('loadingSection').classList.add('hidden');
            document.getElementById('apiKeySection').classList.remove('hidden');
            document.getElementById('apiKeyStatus').innerHTML = 
                '<span style="color: red;">❌ Loading failed: ' + data.error + '</span>';
        }

        function handleDataLoaded(data) {
            currentChanges = data.changes;
            
            document.getElementById('loadingSection').classList.add('hidden');
            
            // Set current model in dropdown
            if (data.currentModel) {
                document.getElementById('modelSelect').value = data.currentModel;
            }
            
            if (data.claudeConfigured) {
                showMainInterface();
                updateFilesCount(data.changes.length);
                renderFileTree(data.changes);
            } else {
                document.getElementById('apiKeySection').classList.remove('hidden');
                
                if (data.maskedApiKey) {
                    document.getElementById('apiKeyStatus').innerHTML = 
                        '<span style="color: var(--vscode-warningForeground);">⚠ Saved API key: ' + data.maskedApiKey + ' (click Set API Key to re-activate)</span>';
                    document.getElementById('apiKeyInput').placeholder = 'API key saved, enter again to reactivate';
                }
            }
        }

        function handleApiKeySet(data) {
            if (data.success) {
                document.getElementById('apiKeySection').classList.add('hidden');
                showMainInterface();
                document.getElementById('apiKeyStatus').innerHTML = 
                    '<span style="color: var(--vscode-testing-iconPassed);">✓ API key configured</span>';
            } else {
                document.getElementById('apiKeyStatus').innerHTML = 
                    '<span style="color: var(--vscode-errorForeground);">✗ Failed to configure API key</span>';
            }
        }

        function handleModelSet(data) {
            if (data.success) {
                document.getElementById('apiKeyStatus').innerHTML = 
                    '<span style="color: var(--vscode-testing-iconPassed);">✓ Model updated to ' + data.modelName + '</span>';
            } else {
                document.getElementById('apiKeyStatus').innerHTML = 
                    '<span style="color: var(--vscode-errorForeground);">✗ Failed to update model</span>';
            }
        }

        function handleCommitInfo(data) {
            // Show commit info
            document.getElementById('commitHash').textContent = data.commitHash;
            document.getElementById('commitAuthor').textContent = 'by ' + data.author;
            document.getElementById('commitMessage').textContent = data.commitMessage;
            document.getElementById('commitDate').textContent = new Date(data.date).toLocaleDateString();
            document.getElementById('commitFileCount').textContent = data.fileCount;
            
            // Show commit info section
            document.getElementById('commitInfo').classList.remove('hidden');
            
            // Expand last commit section
            const content = document.getElementById('lastCommitContent');
            const icon = document.getElementById('lastCommitIcon');
            content.classList.remove('collapsed');
            content.style.maxHeight = '400px';
            icon.classList.add('expanded');
        }

        function handleAnalysisStarted(data) {
            updateProgressSteps(0);
            showSection('reviewsSection');
            // Remove the timeout delay for more responsive progress
            updateProgressSteps(1);
        }

        function handleFileAnalyzed(data) {
            updateProgressSteps(2);
        }

        function handleAnalysisCompleted(data) {
            console.log("✅ Analysis completed, received data:", data);
            updateProgressSteps(3);
            showSection('resultsSection');
            
            if (data.results && Array.isArray(data.results)) {
                console.log("📊 Rendering results for", data.results.length, "files");
                renderResults(data.results);
            } else {
                console.log("❌ Invalid results data:", data.results);
            }
        }

        function handleAnalysisError(data) {
            document.getElementById('apiKeyStatus').innerHTML = 
                '<span style="color: var(--vscode-errorForeground);">Analysis failed: ' + data.error + '</span>';
        }

        function showMainInterface() {
            showSection('newReviewSection');
            showSection('filesToReviewSection');
            
            // Auto-expand files section with scroll support
            const content = document.getElementById('filesToReviewContent');
            const icon = document.getElementById('filesToReviewIcon');
            content.classList.remove('collapsed');
            content.style.maxHeight = '400px';
            icon.classList.add('expanded');
        }

        function showSection(sectionId) {
            document.getElementById(sectionId).classList.remove('hidden');
        }

        function hideAllSections() {
            ['newReviewSection', 'filesToReviewSection', 'reviewsSection', 'resultsSection'].forEach(id => {
                document.getElementById(id).classList.add('hidden');
            });
        }

        function updateFilesCount(count) {
            document.getElementById('filesCount').textContent = count;
        }

        function renderFileTree(changes) {
            const fileTree = document.getElementById('fileTree');
            fileTree.innerHTML = '';
            
            changes.forEach(change => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                
                fileItem.innerHTML = 
                    '<span class="file-icon">' + getFileIcon(change.path) + '</span>' +
                    '<div class="file-info">' +
                        '<div class="file-name">' + change.path + '</div>' +
                        '<div class="file-status">' + change.type + '</div>' +
                    '</div>' +
                    '<div class="file-actions">' +
                        '<button class="action-btn small" onclick="analyzeFullFile(\\'' + change.path + '\\')" title="Analyze entire file">' +
                            '🔍 Analyze File' +
                        '</button>' +
                    '</div>';
                
                fileTree.appendChild(fileItem);
            });
        }



        function analyzeFullFile(filePath) {
            vscode.postMessage({
                command: 'analyzeFullFile',
                data: { filePath }
            });
        }

        function renderResults(results) {
            console.log("🎨 Starting to render results:", results);
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = '';
            
            if (!results || !Array.isArray(results)) {
                console.log("❌ Invalid results format");
                resultsDiv.innerHTML = '<div class="error-message">Invalid results format</div>';
                return;
            }
            
            results.forEach((result, index) => {
                console.log("🔍 Processing result " + index + ":", result);
                // Count issues by type
                const errorCount = result.issues.filter(i => i.type === 'error').length;
                const warningCount = result.issues.filter(i => i.type === 'warning').length;
                const infoCount = result.issues.filter(i => i.type === 'info').length;
                const totalIssues = result.issues.length;
                
                // Create file section container
                const fileSection = document.createElement('div');
                fileSection.className = 'file-section';
                fileSection.id = 'file-section-' + index;
                
                // File header with collapsible functionality
                const fileHeader = document.createElement('div');
                fileHeader.className = 'file-results-header';
                fileHeader.onclick = () => toggleFileResults(index);
                fileHeader.innerHTML = 
                    '<div class="file-results-info">' +
                        '<span class="file-icon">' + getFileIcon(result.file) + '</span>' +
                        '<div class="file-info">' +
                            '<div class="file-name">' + result.file + '</div>' +
                            '<div class="file-status">Score: ' + result.score + '/10 | ' + totalIssues + ' issues</div>' +
                        '</div>' +
                        '<div class="file-results-counts">' +
                            (errorCount > 0 ? '<span class="count-badge error">' + errorCount + '</span>' : '') +
                            (warningCount > 0 ? '<span class="count-badge warning">' + warningCount + '</span>' : '') +
                            (infoCount > 0 ? '<span class="count-badge info">' + infoCount + '</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<span class="file-results-toggle" id="toggle-' + index + '">▶</span>';
                
                // File content container
                const fileContent = document.createElement('div');
                fileContent.className = 'file-results-content collapsible collapsed';
                fileContent.id = 'content-' + index;
                
                // Add issues to content
                if (result.issues.length > 0) {
                    result.issues.forEach(issue => {
                        const comment = document.createElement('div');
                        comment.className = 'review-comment';
                        comment.innerHTML = 
                            '<div class="comment-text" onclick="openFile(\\'' + result.file + '\\', ' + issue.line + ')">' +
                                'Line ' + issue.line + ': ' + issue.message +
                            '</div>' +
                            '<span class="comment-tag ' + issue.type + '">' + issue.source + ' ' + issue.type + '</span>';
                        fileContent.appendChild(comment);
                        
                        // Add corresponding suggestion if exists (hidden by default)
                        const suggestion = result.suggestions.find(s => s.line === issue.line);
                        if (suggestion) {
                            const suggestionItem = document.createElement('div');
                            suggestionItem.className = 'review-comment suggestion-item hidden';
                            suggestionItem.style.marginLeft = '16px';
                            suggestionItem.style.borderLeft = '2px solid var(--vscode-descriptionForeground)';
                            suggestionItem.style.marginTop = '4px';
                            suggestionItem.style.marginBottom = '8px';
                            suggestionItem.innerHTML = 
                                '<div class="comment-text">' +
                                    '💡 ' + suggestion.message +
                                '</div>' +
                                '<span class="comment-tag">suggestion</span>';
                            fileContent.appendChild(suggestionItem);
                            
                            // Add show/hide suggestion button
                            const suggestionToggle = document.createElement('div');
                            suggestionToggle.className = 'suggestion-toggle';
                            suggestionToggle.innerHTML = 
                                '<span class="suggestion-btn" onclick="toggleSuggestion(this, \\'' + result.file + '\\', ' + issue.line + ')">' +
                                    '💡 Show suggestion' +
                                '</span>';
                            comment.appendChild(suggestionToggle);
                        }
                    });
                } else {
                    const noIssues = document.createElement('div');
                    noIssues.className = 'review-comment';
                    noIssues.innerHTML = 
                        '<div class="comment-text">' +
                            'No issues found in this file.' +
                        '</div>' +
                        '<span class="comment-tag">✓ Clean</span>';
                    fileContent.appendChild(noIssues);
                }
                
                // Add remaining suggestions that don't correspond to specific issues
                const remainingSuggestions = result.suggestions.filter(s => 
                    !result.issues.some(i => i.line === s.line)
                );
                
                if (remainingSuggestions.length > 0) {
                    const suggestionsHeader = document.createElement('div');
                    suggestionsHeader.className = 'review-comment suggestions-header';
                    suggestionsHeader.innerHTML = 
                        '<div class="comment-text">' +
                            '<strong>General Suggestions (' + remainingSuggestions.length + ')</strong>' +
                            '<span class="suggestion-btn" onclick="toggleGeneralSuggestions(this, ' + index + ')">' +
                                '💡 Show suggestions' +
                            '</span>' +
                        '</div>';
                    fileContent.appendChild(suggestionsHeader);
                    
                    const suggestionsContainer = document.createElement('div');
                    suggestionsContainer.className = 'suggestions-container hidden';
                    suggestionsContainer.id = 'general-suggestions-' + index;
                    
                    remainingSuggestions.forEach(suggestion => {
                        const suggestionItem = document.createElement('div');
                        suggestionItem.className = 'review-comment';
                        suggestionItem.style.marginLeft = '16px';
                        suggestionItem.style.borderLeft = '2px solid var(--vscode-descriptionForeground)';
                        suggestionItem.innerHTML = 
                            '<div class="comment-text">' +
                                '💡 ' + suggestion.message +
                            '</div>' +
                            '<span class="comment-tag">suggestion</span>';
                        suggestionsContainer.appendChild(suggestionItem);
                    });
                    
                    fileContent.appendChild(suggestionsContainer);
                }
                
                // Assemble the file section
                fileSection.appendChild(fileHeader);
                fileSection.appendChild(fileContent);
                resultsDiv.appendChild(fileSection);
            });
        }

        function toggleFileResults(index) {
            const content = document.getElementById('content-' + index);
            const toggle = document.getElementById('toggle-' + index);
            
            if (!content || !toggle) {
                return;
            }
            
            // Ensure the results section is expanded
            ensureResultsSectionExpanded();
            
            if (content.classList.contains('collapsed')) {
                // First, temporarily remove collapsed class to calculate height
                content.classList.remove('collapsed');
                content.style.maxHeight = 'none';
                
                // Get the actual height
                const height = content.scrollHeight;
                
                // Set the height for animation
                content.style.maxHeight = height + 'px';
                toggle.classList.add('expanded');
                
                // After animation, set to auto to allow content to grow if needed
                setTimeout(() => {
                    if (!content.classList.contains('collapsed')) {
                        content.style.maxHeight = 'none';
                    }
                }, 300);
            } else {
                // Get current height before collapsing
                const height = content.scrollHeight;
                content.style.maxHeight = height + 'px';
                
                // Force reflow
                content.offsetHeight;
                
                // Collapse
                content.classList.add('collapsed');
                content.style.maxHeight = '0px';
                toggle.classList.remove('expanded');
            }
        }

        function ensureResultsSectionExpanded() {
            const resultsContent = document.getElementById('resultsContent');
            const resultsIcon = document.getElementById('resultsIcon');
            
            if (resultsContent && resultsContent.classList.contains('collapsed')) {
                resultsContent.classList.remove('collapsed');
                resultsContent.style.maxHeight = 'none';
                if (resultsIcon) {
                    resultsIcon.classList.add('expanded');
                }
            }
        }

        function toggleSuggestion(button, filePath, line) {
            const comment = button.closest('.review-comment');
            const suggestionItem = comment.nextElementSibling;
            
            if (suggestionItem && suggestionItem.classList.contains('suggestion-item')) {
                if (suggestionItem.classList.contains('hidden')) {
                    suggestionItem.classList.remove('hidden');
                    button.textContent = '💡 Hide suggestion';
                    button.classList.add('showing');
                } else {
                    suggestionItem.classList.add('hidden');
                    button.textContent = '💡 Show suggestion';
                    button.classList.remove('showing');
                }
            }
        }

        function toggleGeneralSuggestions(button, fileIndex) {
            const suggestionsContainer = document.getElementById('general-suggestions-' + fileIndex);
            
            if (suggestionsContainer) {
                if (suggestionsContainer.classList.contains('hidden')) {
                    suggestionsContainer.classList.remove('hidden');
                    button.textContent = '💡 Hide suggestions';
                    button.classList.add('showing');
                } else {
                    suggestionsContainer.classList.add('hidden');
                    button.textContent = '💡 Show suggestions';
                    button.classList.remove('showing');
                }
            }
        }
    </script>
</body>
</html>`;
  }

  public dispose(): void {
    this.logger.logOperation("Disposing CodeReviewProvider");

    if (this.panel) {
      this.panel.dispose();
      this.logger.debug("Panel disposed");
    }

    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.logger.debug("All disposables disposed");

    this.logger.info("CodeReviewProvider disposed successfully");
  }
}
