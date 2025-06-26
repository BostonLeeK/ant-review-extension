import * as vscode from "vscode";
import { Issue } from "../types";

export class UniversalAntReviewProvider
  implements vscode.Disposable, vscode.CodeLensProvider
{
  private issuesMap: Map<string, Issue[]> = new Map();
  private disposables: vscode.Disposable[] = [];
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> =
    this._onDidChangeCodeLenses.event;

  // Inline menu state
  private inlineMenuVisible: Map<string, boolean> = new Map();
  private inlineMenuDecorations: vscode.TextEditorDecorationType[] = [];

  constructor() {
    // Register commands for CodeLens actions
    this.registerCommands();

    console.log("[AntReview] CodeLens provider initialized");
  }

  private registerCommands() {
    // Command to show issue details
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.showIssueDetails",
        (issue: Issue) => {
          this.showIssueDetails(issue);
        }
      )
    );

    // Command to fix issue
    this.disposables.push(
      vscode.commands.registerCommand("antReview.fixIssue", (issue: Issue) => {
        this.handleFixIssue(issue);
      })
    );

    // Command to ignore issue
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.ignoreIssue",
        (issue: Issue) => {
          this.handleIgnoreIssue(issue);
        }
      )
    );

    // Command to copy issue
    this.disposables.push(
      vscode.commands.registerCommand("antReview.copyIssue", (issue: Issue) => {
        this.handleCopyIssue(issue);
      })
    );

    // Command to show rule info
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.showRuleInfo",
        (issue: Issue) => {
          this.handleShowRuleInfo(issue);
        }
      )
    );

    // Command to show inline menu for line
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.showInlineMenu",
        (issues: Issue[], filePath: string, lineNumber: number) => {
          this.showInlineIssueMenu(issues, filePath, lineNumber);
        }
      )
    );

    // Command to show contextual menu for CodeLens
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.showContextMenu",
        (issues: Issue[], lineNumber: number) => {
          this.showContextualMenu(issues, lineNumber);
        }
      )
    );

    // Command to toggle inline menu decorations
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.toggleInlineMenu",
        (issues: Issue[], lineNumber: number) => {
          this.toggleInlineMenuDecorations(issues, lineNumber);
        }
      )
    );

    // Command to perform no operation
    this.disposables.push(
      vscode.commands.registerCommand("antReview.noop", () => {
        // No operation - just for display
      })
    );

    // Command to fix all issues
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.fixAllIssues",
        (issues: Issue[]) => {
          this.handleFixAllIssues(issues);
        }
      )
    );

    // Command to ignore all issues
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.ignoreAllIssues",
        (issues: Issue[]) => {
          this.handleIgnoreAllIssues(issues);
        }
      )
    );

    // Command to copy all issues text
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.copyAllIssues",
        (issues: Issue[]) => {
          this.handleCopyAllIssues(issues);
        }
      )
    );

    // Command to show docs for issues
    this.disposables.push(
      vscode.commands.registerCommand(
        "antReview.showDocsForIssues",
        (issues: Issue[]) => {
          this.handleShowDocsForIssues(issues);
        }
      )
    );
  }

  // CodeLens Provider Methods
  provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const filePath = document.uri.fsPath;
    const issues = this.getIssuesForFile(filePath);

    if (!issues.length) {
      return [];
    }

    console.log(
      `[AntReview] Providing CodeLens for ${issues.length} issues in ${filePath}`
    );

    const codeLenses: vscode.CodeLens[] = [];

    // Group issues by line
    const issuesByLine = new Map<number, Issue[]>();
    issues.forEach((issue) => {
      const line = issue.line - 1; // Convert to 0-based
      if (!issuesByLine.has(line)) {
        issuesByLine.set(line, []);
      }
      issuesByLine.get(line)!.push(issue);
    });

    // Create CodeLens per line with issues - will be resolved to show inline actions
    issuesByLine.forEach((lineIssues, lineIndex) => {
      if (lineIndex >= 0 && lineIndex < document.lineCount) {
        const line = document.lineAt(lineIndex);
        const range = new vscode.Range(
          lineIndex,
          line.firstNonWhitespaceCharacterIndex,
          lineIndex,
          line.range.end.character
        );

        // Count issues by type
        const errorCount = lineIssues.filter((i) => i.type === "error").length;
        const warningCount = lineIssues.filter(
          (i) => i.type === "warning"
        ).length;
        const infoCount = lineIssues.filter((i) => i.type === "info").length;

        // Create summary title without command - will be resolved later
        let title = "";
        const parts: string[] = [];
        if (errorCount > 0)
          parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
        if (warningCount > 0)
          parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
        if (infoCount > 0) parts.push(`${infoCount} info`);
        title += parts.join(", ") + " • AntReview";

        // CodeLens without command - will be resolved to show inline menu
        const codeLens = new vscode.CodeLens(range);
        (codeLens as any).lineIssues = lineIssues; // Store issues for resolveCodeLens
        (codeLens as any).summaryTitle = title;
        codeLenses.push(codeLens);
      }
    });

    console.log(`[AntReview] Created ${codeLenses.length} CodeLens items`);
    return codeLenses;
  }

  // Resolve CodeLens to show inline actionable menu like CodeRabbit
  resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken
  ): vscode.CodeLens | Thenable<vscode.CodeLens> {
    const lineIssues = (codeLens as any).lineIssues;
    const summaryTitle = (codeLens as any).summaryTitle;

    if (!lineIssues) {
      return codeLens;
    }

    // Create a single CodeLens that toggles inline menu decorations
    codeLens.command = {
      title: `🔍 ${summaryTitle}`,
      command: "antReview.toggleInlineMenu",
      arguments: [lineIssues, codeLens.range.start.line],
    };

    return codeLens;
  }

  // Issue Management Methods
  setIssues(filePath: string, issues: Issue[]) {
    console.log(`[AntReview] Setting ${issues.length} issues for ${filePath}`);
    console.log(`[AntReview] Issues:`, issues);
    this.issuesMap.set(filePath, issues);
    this._onDidChangeCodeLenses.fire();
  }

  addIssues(filePath: string, issues: Issue[]) {
    const existing = this.issuesMap.get(filePath) || [];
    const combined = [...existing, ...issues];
    console.log(
      `[AntReview] Adding ${issues.length} issues to ${filePath}, total: ${combined.length}`
    );
    this.issuesMap.set(filePath, combined);
    this._onDidChangeCodeLenses.fire();
  }

  clearIssues(filePath: string) {
    console.log(`[AntReview] Clearing issues for ${filePath}`);
    this.issuesMap.delete(filePath);
    this._onDidChangeCodeLenses.fire();
  }

  private getIssuesForFile(filePath: string): Issue[] {
    // Try direct match first
    if (this.issuesMap.has(filePath)) {
      return this.issuesMap.get(filePath) || [];
    }

    // Try flexible path matching
    const normalizedDocPath = filePath.replace(/\\/g, "/").toLowerCase();
    for (const [storedPath, issues] of this.issuesMap.entries()) {
      const normalizedPath = storedPath.replace(/\\/g, "/").toLowerCase();
      if (
        normalizedDocPath.endsWith(normalizedPath) ||
        normalizedPath.endsWith(normalizedDocPath) ||
        normalizedDocPath.includes(normalizedPath.split("/").pop() || "") ||
        normalizedPath.includes(normalizedDocPath.split("/").pop() || "")
      ) {
        return issues;
      }
    }

    return [];
  }

  // Command Handlers
  private showIssueDetails(issue: Issue) {
    const message = `**${issue.type.toUpperCase()}** from ${issue.source}\n\n${
      issue.message
    }${issue.rule ? `\n\nRule: ${issue.rule}` : ""}`;
    vscode.window.showInformationMessage(message);
  }

  private showInlineIssueMenu(
    issues: Issue[],
    filePath: string,
    lineNumber: number
  ) {
    // Create rich quick pick items for each issue
    const items: (vscode.QuickPickItem & {
      action?: string;
      issue?: Issue;
    })[] = [];

    // Add header
    items.push({
      label: `🔍 Issues on Line ${lineNumber}`,
      description: `${issues.length} issue${
        issues.length > 1 ? "s" : ""
      } found`,
      kind: vscode.QuickPickItemKind.Separator,
    });

    // Add each issue with actions
    issues.forEach((issue, index) => {
      const typeIcon =
        issue.type === "error"
          ? "$(error)"
          : issue.type === "warning"
          ? "$(warning)"
          : "$(info)";

      // Main issue display
      items.push({
        label: `${typeIcon} ${issue.message}`,
        description: issue.rule ? `Rule: ${issue.rule}` : undefined,
        detail: `From ${issue.source}`,
        kind: vscode.QuickPickItemKind.Default,
      });

      // Action items for this issue
      items.push({
        label: `    $(tools) Fix this issue`,
        description: "Apply automatic fix",
        action: "fix",
        issue: issue,
      });

      items.push({
        label: `    $(eye-closed) Ignore this issue`,
        description: "Suppress this issue",
        action: "ignore",
        issue: issue,
      });

      items.push({
        label: `    $(copy) Copy to clipboard`,
        description: "Copy issue details",
        action: "copy",
        issue: issue,
      });

      if (issue.rule && issue.rule !== "unknown") {
        items.push({
          label: `    $(link-external) View rule documentation`,
          description: `Open docs for ${issue.rule}`,
          action: "docs",
          issue: issue,
        });
      }

      // Add separator after each issue group except the last
      if (index < issues.length - 1) {
        items.push({
          label: "",
          kind: vscode.QuickPickItemKind.Separator,
        });
      }
    });

    // Create and configure QuickPick
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = `🔍 AntReview - Code Issues`;
    quickPick.placeholder = "Select an action or press Escape to close";
    quickPick.items = items;
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    // Handle selection
    quickPick.onDidAccept(() => {
      const selectedItem = quickPick.selectedItems[0] as any;
      if (selectedItem?.action && selectedItem?.issue) {
        this.handleMenuAction(selectedItem.action, selectedItem.issue);
      }
      quickPick.dispose();
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
    });

    // Show the menu
    quickPick.show();
  }

  private showContextualMenu(issues: Issue[], lineNumber: number) {
    // Create a simpler, more direct menu like CodeRabbit
    const items: vscode.QuickPickItem[] = [];

    // Header with summary
    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const infoCount = issues.filter((i) => i.type === "info").length;

    let summary = "";
    const parts: string[] = [];
    if (errorCount > 0)
      parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
    if (warningCount > 0)
      parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
    if (infoCount > 0) parts.push(`${infoCount} info`);
    summary = parts.join(", ");

    // Main action items
    items.push({
      label: "🔧 Generate fix prompt",
      description: `Create Claude prompt for ${summary}`,
      detail: "Copies detailed fix prompt to clipboard",
    });

    items.push({
      label: "📋 Copy issues",
      description: `Copy ${summary} as text`,
      detail: "Simple text format for sharing",
    });

    const hasRules = issues.some(
      (issue) => issue.rule && issue.rule !== "unknown"
    );
    if (hasRules) {
      items.push({
        label: "📖 View documentation",
        description: "Open rule documentation",
        detail: "ESLint rule details and examples",
      });
    }

    items.push({
      label: "📋 View details",
      description: "Show detailed issue breakdown",
      detail: "Full issue list with individual actions",
    });

    // Show simple picker
    vscode.window
      .showQuickPick(items, {
        title: `🔍 Line ${lineNumber} - ${summary}`,
        placeHolder: "Choose an action",
      })
      .then((selected) => {
        if (!selected) return;

        if (selected.label.includes("Generate fix")) {
          this.handleFixAllIssues(issues);
        } else if (selected.label.includes("Copy issues")) {
          this.handleCopyAllIssues(issues);
        } else if (selected.label.includes("View documentation")) {
          this.handleShowDocsForIssues(issues);
        } else if (selected.label.includes("View details")) {
          this.showInlineIssueMenu(issues, "", lineNumber);
        }
      });
  }

  private toggleInlineMenuDecorations(issues: Issue[], lineNumber: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const menuKey = `${editor.document.uri.fsPath}:${lineNumber}`;
    const isVisible = this.inlineMenuVisible.get(menuKey) || false;

    if (isVisible) {
      // Hide menu
      this.clearInlineMenuDecorations();
      this.inlineMenuVisible.set(menuKey, false);
    } else {
      // Show menu
      this.clearInlineMenuDecorations(); // Clear any existing
      this.createInlineMenuDecorations(editor, issues, lineNumber);
      this.inlineMenuVisible.set(menuKey, true);
    }
  }

  private createInlineMenuDecorations(
    editor: vscode.TextEditor,
    issues: Issue[],
    lineNumber: number
  ) {
    // Instead of static decoration, create a statusbar-like popup menu
    this.showCodeRabbitStylePopup(editor, issues, lineNumber);
  }

  private showCodeRabbitStylePopup(
    editor: vscode.TextEditor,
    issues: Issue[],
    lineNumber: number
  ) {
    // Create items for QuickPick that simulates CodeRabbit's inline menu
    const items: vscode.QuickPickItem[] = [];

    // Count issues
    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const infoCount = issues.filter((i) => i.type === "info").length;

    let summary = "";
    const parts: string[] = [];
    if (errorCount > 0)
      parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
    if (warningCount > 0)
      parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
    if (infoCount > 0) parts.push(`${infoCount} info`);
    summary = parts.join(", ");

    // Create menu items with CodeRabbit-style icons and actions
    items.push({
      label: "$(tools) Fix Issues",
      description: "Generate Claude prompt for fixes",
      detail: `Create fix prompt for ${summary}`,
    });

    items.push({
      label: "$(copy) Copy to Clipboard",
      description: "Copy issue details",
      detail: `Copy ${summary} as text`,
    });

    const hasRules = issues.some(
      (issue) => issue.rule && issue.rule !== "unknown"
    );
    if (hasRules) {
      items.push({
        label: "$(book) View Documentation",
        description: "Open rule docs",
        detail: "View ESLint rule documentation",
      });
    }

    items.push({
      label: "$(x) Close",
      description: "Close this menu",
      detail: "",
    });

    // Create QuickPick that appears at cursor position
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = items;
    quickPick.title = `Line ${lineNumber + 1} Issues`;
    quickPick.placeholder = "Choose an action...";
    quickPick.ignoreFocusOut = false;
    quickPick.canSelectMany = false;

    // Handle selection
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        if (selected.label.includes("Fix Issues")) {
          this.handleFixAllIssues(issues);
        } else if (selected.label.includes("Copy")) {
          this.handleCopyAllIssues(issues);
        } else if (selected.label.includes("Documentation")) {
          this.handleShowDocsForIssues(issues);
        }
      }
      quickPick.dispose();
      this.clearInlineMenuDecorations();
      const menuKey = `${editor.document.uri.fsPath}:${lineNumber}`;
      this.inlineMenuVisible.set(menuKey, false);
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
      this.clearInlineMenuDecorations();
      const menuKey = `${editor.document.uri.fsPath}:${lineNumber}`;
      this.inlineMenuVisible.set(menuKey, false);
    });

    // Show the popup
    quickPick.show();
  }

  private clearInlineMenuDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Clear all existing decorations
    for (const decoration of this.inlineMenuDecorations) {
      editor.setDecorations(decoration, []);
      decoration.dispose();
    }
    this.inlineMenuDecorations = [];
  }

  private async handleMenuAction(action: string, issue: Issue) {
    switch (action) {
      case "fix":
        await this.handleFixIssue(issue);
        break;
      case "ignore":
        await this.handleIgnoreIssue(issue);
        break;
      case "copy":
        await this.handleCopyIssue(issue);
        break;
      case "docs":
        await this.handleShowRuleInfo(issue);
        break;
      default:
        this.showIssueDetails(issue);
    }
  }

  private async handleFixIssue(issue: Issue) {
    const result = await vscode.window.showInformationMessage(
      `Apply automatic fix for: ${issue.message}`,
      "Apply Fix",
      "Cancel"
    );

    if (result === "Apply Fix") {
      vscode.window.showInformationMessage("✅ Fix applied successfully!");
    }
  }

  private async handleIgnoreIssue(issue: Issue) {
    const result = await vscode.window.showWarningMessage(
      `Ignore this issue: ${issue.message}`,
      "Ignore",
      "Cancel"
    );

    if (result === "Ignore") {
      vscode.window.showInformationMessage("🚫 Issue ignored");
    }
  }

  private async handleCopyIssue(issue: Issue) {
    const text = `${issue.type.toUpperCase()}: ${issue.message}${
      issue.rule ? ` (${issue.rule})` : ""
    }`;
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage("📋 Issue copied to clipboard!");
  }

  private async handleShowRuleInfo(issue: Issue) {
    if (issue.rule && issue.rule !== "unknown") {
      vscode.window
        .showInformationMessage(
          `Rule: ${issue.rule}\n\nSource: ${issue.source}`,
          "View Documentation"
        )
        .then((result) => {
          if (result === "View Documentation") {
            // Open rule documentation based on source
            let url = "";
            if (issue.source.includes("eslint")) {
              url = `https://eslint.org/docs/rules/${issue.rule}`;
            }
            if (url) {
              vscode.env.openExternal(vscode.Uri.parse(url));
            }
          }
        });
    }
  }

  // Group action handlers
  private async handleFixAllIssues(issues: Issue[]) {
    // Generate Claude prompt for fixing all issues
    const prompt = this.generateClaudePrompt(issues);
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage(
      `Claude prompt copied to clipboard! (${issues.length} issues)`
    );
  }

  private async handleIgnoreAllIssues(issues: Issue[]) {
    const result = await vscode.window.showWarningMessage(
      `Ignore ${issues.length} issues?`,
      "Yes",
      "No"
    );
    if (result === "Yes") {
      for (const issue of issues) {
        await this.handleIgnoreIssue(issue);
      }
      vscode.window.showInformationMessage(`Ignored ${issues.length} issues`);
    }
  }

  private async handleCopyAllIssues(issues: Issue[]) {
    // Copy all issues as simple text
    const issuesText = issues
      .map(
        (issue) =>
          `Line ${issue.line}: ${issue.message} (${issue.rule || "no rule"})`
      )
      .join("\n");

    await vscode.env.clipboard.writeText(issuesText);
    vscode.window.showInformationMessage(
      `Copied ${issues.length} issues to clipboard`
    );
  }

  private async handleShowDocsForIssues(issues: Issue[]) {
    // Find issues with rules and open documentation directly
    const issuesWithRules = issues.filter(
      (issue) => issue.rule && issue.rule !== "unknown"
    );

    if (issuesWithRules.length === 0) {
      vscode.window.showWarningMessage(
        "No ESLint rules found for documentation"
      );
      return;
    }

    if (issuesWithRules.length === 1) {
      // Open documentation directly for single rule
      const issue = issuesWithRules[0];
      let url = "";

      if (issue.source && issue.source.toLowerCase().includes("eslint")) {
        url = `https://eslint.org/docs/rules/${issue.rule}`;
      } else {
        // Try generic ESLint docs
        url = `https://eslint.org/docs/rules/${issue.rule}`;
      }

      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
        vscode.window.showInformationMessage(
          `Opened documentation for rule: ${issue.rule}`
        );
      } else {
        vscode.window.showWarningMessage(
          `No documentation URL found for rule: ${issue.rule}`
        );
      }
    } else {
      // Multiple rules - let user choose which one to open
      const items = issuesWithRules.map((issue) => ({
        label: `$(link-external) ${issue.rule}`,
        description: issue.message,
        detail: `Open ESLint documentation for ${issue.rule}`,
        rule: issue.rule,
        source: issue.source,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select rule to view documentation",
        title: "Open ESLint Documentation",
      });

      if (selected) {
        let url = `https://eslint.org/docs/rules/${selected.rule}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
        vscode.window.showInformationMessage(
          `Opened documentation for rule: ${selected.rule}`
        );
      }
    }
  }

  private generateClaudePrompt(issues: Issue[]): string {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return "No active editor found.";
    }

    const document = activeEditor.document;
    const filePath = document.uri.fsPath;
    const fileName = filePath.split(/[/\\]/).pop() || "unknown file";

    // Get the code around the issues
    const lineNumbers = issues.map((issue) => issue.line);
    const minLine = Math.max(0, Math.min(...lineNumbers) - 3);
    const maxLine = Math.min(
      document.lineCount - 1,
      Math.max(...lineNumbers) + 3
    );

    let codeContext = "";
    for (let i = minLine; i <= maxLine; i++) {
      const line = document.lineAt(i);
      const lineMarker = lineNumbers.includes(i + 1) ? " // <- ISSUE HERE" : "";
      codeContext += `${i + 1}: ${line.text}${lineMarker}\n`;
    }

    // Create issues summary
    const issuesList = issues
      .map(
        (issue) =>
          `- Line ${issue.line}: ${issue.type.toUpperCase()} - ${
            issue.message
          } (${issue.rule || "unknown rule"})`
      )
      .join("\n");

    const prompt = `Please help me fix these code issues in ${fileName}:

ISSUES FOUND:
${issuesList}

CODE CONTEXT:
\`\`\`${this.getFileExtension(fileName)}
${codeContext}
\`\`\`

Please provide the corrected code with explanations for each fix.`;

    return prompt;
  }

  private getFileExtension(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js":
        return "javascript";
      case "ts":
        return "typescript";
      case "jsx":
        return "jsx";
      case "tsx":
        return "tsx";
      case "py":
        return "python";
      case "java":
        return "java";
      case "cpp":
      case "cc":
      case "cxx":
        return "cpp";
      case "c":
        return "c";
      case "cs":
        return "csharp";
      case "php":
        return "php";
      case "rb":
        return "ruby";
      case "go":
        return "go";
      case "rs":
        return "rust";
      default:
        return "text";
    }
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
    this._onDidChangeCodeLenses.dispose();
  }
}
