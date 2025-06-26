// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ANTAnalyzer } from "./analyzers/ANTAnalyzer";
import { DiffAnalyzer } from "./analyzers/DiffAnalyzer";
import { LinterAnalyzer } from "./analyzers/LinterAnalyzer";
import { UniversalAntReviewProvider } from "./providers/AntCodeLensProvider";
import { CodeReviewProvider } from "./providers/CodeReviewProvider";
import { ClaudeService } from "./services/ClaudeService";
import { GitService } from "./services/GitService";
import { LoggerService } from "./services/LoggerService";

let logger: LoggerService;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  logger = new LoggerService();
  logger.logOperation("Extension activation started");

  try {
    const gitService = new GitService(logger);
    const claudeService = new ClaudeService(context, logger);
    const antAnalyzer = new ANTAnalyzer(logger);
    const diffAnalyzer = new DiffAnalyzer(logger, claudeService);
    const linterAnalyzer = new LinterAnalyzer(logger);

    logger.info("Services initialized", {
      gitService: "GitService",
      claudeService: "ClaudeService",
      antAnalyzer: "ANTAnalyzer",
      diffAnalyzer: "DiffAnalyzer",
      linterAnalyzer: "LinterAnalyzer",
    });

    // --- Universal AntReview Provider integration ---
    const universalAntReviewProvider = new UniversalAntReviewProvider();

    // Register CodeLens provider for clickable line indicators
    const codeLensProvider = vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      universalAntReviewProvider
    );

    const codeReviewProvider = new CodeReviewProvider(
      context.extensionUri,
      gitService,
      claudeService,
      antAnalyzer,
      diffAnalyzer,
      linterAnalyzer,
      universalAntReviewProvider,
      logger
    );

    logger.info("CodeReviewProvider created");

    // Register webview for sidebar
    const sidebarProvider = vscode.window.registerWebviewViewProvider(
      "codeReview.sidebarView",
      codeReviewProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    );

    logger.info("Sidebar provider registered");

    const openPanelCommand = vscode.commands.registerCommand(
      "code-review.openPanel",
      () => {
        logger.logOperation("Open panel command executed");
        codeReviewProvider.show();
      }
    );

    const refreshChangesCommand = vscode.commands.registerCommand(
      "code-review.refreshChanges",
      () => {
        logger.logOperation("Refresh changes command executed");
        codeReviewProvider.refreshChanges();
      }
    );

    const showLogsCommand = vscode.commands.registerCommand(
      "code-review.showLogs",
      () => {
        logger.logOperation("Show logs command executed");
        logger.showOutput();
      }
    );

    const clearLogsCommand = vscode.commands.registerCommand(
      "code-review.clearLogs",
      () => {
        logger.logOperation("Clear logs command executed");
        logger.clear();
      }
    );

    // No automatic analysis - decorations only appear when user runs analysis through panel

    context.subscriptions.push(
      sidebarProvider,
      openPanelCommand,
      refreshChangesCommand,
      showLogsCommand,
      clearLogsCommand,
      universalAntReviewProvider,
      codeLensProvider
    );

    vscode.commands.executeCommand(
      "setContext",
      "codeReview.panelActive",
      true
    );
    vscode.commands.executeCommand("setContext", "codeReview.active", true);

    logger.logOperation("Extension activation completed successfully");
  } catch (error) {
    logger.logError("Extension activation", error);
    throw error;
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (logger) {
    logger.logOperation("Extension deactivation started");
    logger.dispose();
  }
}
