import simpleGit, { SimpleGit } from "simple-git";
import * as vscode from "vscode";
import { FileChange } from "../types";
import { LoggerService } from "./LoggerService";

export class GitService {
  private git: SimpleGit;
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.git = simpleGit(workspaceRoot);
    this.logger.info("GitService initialized", { workspaceRoot });
  }

  async getStagedChanges(): Promise<FileChange[]> {
    this.logger.logServiceCall("GitService", "getStagedChanges");

    try {
      const status = await this.git.status();
      const changes: FileChange[] = [];

      this.logger.debug("Git status retrieved", {
        stagedFiles: status.staged.length,
      });

      for (const file of status.staged) {
        const diff = await this.getDiff(file, true);
        const content = await this.getFileContent(file);

        changes.push({
          path: file,
          type: this.getChangeType(file, status),
          diff,
          content,
        });

        this.logger.debug("Processed staged file", {
          file,
          type: this.getChangeType(file, status),
        });
      }

      this.logger.logServiceResponse("GitService", "getStagedChanges", {
        count: changes.length,
      });
      return changes;
    } catch (error) {
      this.logger.logError("getStagedChanges", error);
      throw new Error(`Failed to get staged changes: ${error}`);
    }
  }

  async getUnstagedChanges(): Promise<FileChange[]> {
    this.logger.logServiceCall("GitService", "getUnstagedChanges");

    try {
      const status = await this.git.status();
      const changes: FileChange[] = [];

      this.logger.debug("Git status retrieved", {
        modifiedFiles: status.modified.length,
        notAddedFiles: status.not_added.length,
      });

      for (const file of [...status.modified, ...status.not_added]) {
        const diff = await this.getDiff(file, false);
        const content = await this.getFileContent(file);

        changes.push({
          path: file,
          type: this.getChangeType(file, status),
          diff,
          content,
        });

        this.logger.debug("Processed unstaged file", {
          file,
          type: this.getChangeType(file, status),
        });
      }

      this.logger.logServiceResponse("GitService", "getUnstagedChanges", {
        count: changes.length,
      });
      return changes;
    } catch (error) {
      this.logger.logError("getUnstagedChanges", error);
      throw new Error(`Failed to get unstaged changes: ${error}`);
    }
  }

  async getAllChanges(): Promise<FileChange[]> {
    this.logger.logServiceCall("GitService", "getAllChanges");

    try {
      const staged = await this.getStagedChanges();
      const unstaged = await this.getUnstagedChanges();

      const allChanges = new Map<string, FileChange>();

      [...staged, ...unstaged].forEach((change) => {
        if (
          !allChanges.has(change.path) ||
          staged.some((s) => s.path === change.path)
        ) {
          allChanges.set(change.path, change);
        }
      });

      const result = Array.from(allChanges.values());
      this.logger.logServiceResponse("GitService", "getAllChanges", {
        totalCount: result.length,
        stagedCount: staged.length,
        unstagedCount: unstaged.length,
      });

      return result;
    } catch (error) {
      this.logger.logError("getAllChanges", error);
      throw error;
    }
  }

  private async getDiff(filePath: string, staged: boolean): Promise<string> {
    this.logger.debug("Getting diff", { filePath, staged });

    try {
      if (staged) {
        return await this.git.diff(["--staged", filePath]);
      } else {
        return await this.git.diff([filePath]);
      }
    } catch (error) {
      this.logger.warn("Failed to get diff", {
        filePath,
        staged,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }

  private async getFileContent(filePath: string): Promise<string | undefined> {
    this.logger.debug("Getting file content", { filePath });

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        this.logger.warn("No workspace root found");
        return undefined;
      }

      const fileUri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);

      // Force reload the document to ensure we get fresh content
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === fileUri.fsPath
      );
      if (openDoc && openDoc.isDirty) {
        this.logger.debug("Document is dirty, using current editor content", {
          filePath,
        });
        const content = openDoc.getText();
        this.logger.debug("File content retrieved from dirty document", {
          filePath,
          fullPath: fileUri.fsPath,
          contentLength: content.length,
          contentPreview: content.substring(0, 200).replace(/\n/g, "\\n"),
        });
        return content;
      }

      const document = await vscode.workspace.openTextDocument(fileUri);
      const content = document.getText();

      this.logger.debug("File content retrieved", {
        filePath,
        fullPath: fileUri.fsPath,
        contentLength: content.length,
        contentPreview: content.substring(0, 200).replace(/\n/g, "\\n"),
      });
      return content;
    } catch (error) {
      this.logger.warn("Failed to get file content", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private getChangeType(
    filePath: string,
    status: any
  ): "added" | "modified" | "deleted" {
    if (status.not_added.includes(filePath)) return "added";
    if (status.deleted.includes(filePath)) return "deleted";
    return "modified";
  }

  async getCurrentBranch(): Promise<string> {
    this.logger.logServiceCall("GitService", "getCurrentBranch");

    try {
      const branchSummary = await this.git.branchLocal();
      const currentBranch = branchSummary.current || "main";

      this.logger.logServiceResponse("GitService", "getCurrentBranch", {
        currentBranch,
      });
      return currentBranch;
    } catch (error) {
      this.logger.logError("getCurrentBranch", error);
      return "main";
    }
  }

  async getBaseBranch(): Promise<string> {
    this.logger.logServiceCall("GitService", "getBaseBranch");

    try {
      const currentBranch = await this.getCurrentBranch();

      // Get all local branches to see what's available
      const branches = await this.git.branchLocal();
      const allBranches = Object.keys(branches.branches);

      this.logger.debug("All branches found", {
        currentBranch,
        allBranches,
      });

      // Try common base branches first, prioritizing dev over main/master
      const commonBases = ["dev", "develop", "main", "master"];

      for (const base of commonBases) {
        if (allBranches.includes(base) && base !== currentBranch) {
          this.logger.logServiceResponse("GitService", "getBaseBranch", {
            baseBranch: base,
            method: "common-base",
          });
          return base;
        }
      }

      // If no common bases found, try to find any branch that looks like a main branch
      const mainBranchPatterns = ["dev", "develop", "main", "master", "trunk"];
      for (const pattern of mainBranchPatterns) {
        const foundBranch = allBranches.find(
          (branch) =>
            branch.toLowerCase().includes(pattern) && branch !== currentBranch
        );
        if (foundBranch) {
          this.logger.logServiceResponse("GitService", "getBaseBranch", {
            baseBranch: foundBranch,
            method: "pattern-match",
          });
          return foundBranch;
        }
      }

      // Last resort: return any branch that's not current
      const otherBranch = allBranches.find(
        (branch) => branch !== currentBranch
      );
      if (otherBranch) {
        this.logger.logServiceResponse("GitService", "getBaseBranch", {
          baseBranch: otherBranch,
          method: "any-other",
        });
        return otherBranch;
      }

      this.logger.logServiceResponse("GitService", "getBaseBranch", {
        baseBranch: "main",
        method: "default",
      });
      return "main";
    } catch (error) {
      this.logger.logError("getBaseBranch", error);
      return "main";
    }
  }

  async getFileAsChange(filePath: string): Promise<FileChange> {
    this.logger.logServiceCall("GitService", "getFileAsChange", { filePath });

    try {
      // Get current file content
      const content = await this.getFileContent(filePath);

      // Get diff for this specific file
      const diff = await this.getDiff(filePath, false);

      // Get git status to determine change type
      const status = await this.git.status();
      const changeType = this.getChangeType(filePath, status);

      const fileChange: FileChange = {
        path: filePath,
        type: changeType,
        diff,
        content,
      };

      this.logger.logServiceResponse("GitService", "getFileAsChange", {
        filePath,
        changeType,
        hasContent: !!content,
        hasDiff: !!diff,
      });

      return fileChange;
    } catch (error) {
      this.logger.logError("getFileAsChange", error);
      throw new Error(`Failed to get file as change: ${error}`);
    }
  }

  async refreshGitStatus(): Promise<void> {
    this.logger.logServiceCall("GitService", "refreshGitStatus");

    try {
      // Force refresh git status by calling it
      await this.git.status();
      this.logger.logServiceResponse("GitService", "refreshGitStatus", {
        refreshed: true,
      });
    } catch (error) {
      this.logger.logError("refreshGitStatus", error);
    }
  }

  async getFreshChanges(): Promise<FileChange[]> {
    this.logger.logServiceCall("GitService", "getFreshChanges");

    try {
      // Refresh git status first
      await this.refreshGitStatus();

      // Get all changes with fresh status
      const changes = await this.getAllChanges();

      this.logger.logServiceResponse("GitService", "getFreshChanges", {
        count: changes.length,
      });

      return changes;
    } catch (error) {
      this.logger.logError("getFreshChanges", error);
      throw error;
    }
  }

  async getLastCommitChanges(): Promise<{
    commitHash: string;
    commitMessage: string;
    author: string;
    date: string;
    changes: FileChange[];
  }> {
    this.logger.logServiceCall("GitService", "getLastCommitChanges");

    try {
      // Get last commit info
      const log = await this.git.log(["-1"]);
      if (!log.latest) {
        throw new Error("No commits found in repository");
      }

      const commit = log.latest;
      this.logger.debug("Latest commit found", {
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
      });

      // Get files changed in last commit
      const diffSummary = await this.git.diffSummary([
        commit.hash + "^",
        commit.hash,
      ]);
      const changes: FileChange[] = [];

      for (const file of diffSummary.files) {
        // Get the diff for this specific file
        const diff = await this.git.diff([
          commit.hash + "^",
          commit.hash,
          "--",
          file.file,
        ]);

        // Get current content of the file (if it still exists)
        let content: string | undefined;
        try {
          content = await this.getFileContent(file.file);
        } catch (error) {
          this.logger.debug("Could not get current content for file", {
            file: file.file,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Determine change type based on git diff summary
        let changeType: "added" | "modified" | "deleted";
        const textFile = file as any; // Type assertion for diff summary files
        if (textFile.insertions > 0 && textFile.deletions === 0) {
          changeType = "added";
        } else if (textFile.insertions === 0 && textFile.deletions > 0) {
          changeType = "deleted";
        } else {
          changeType = "modified";
        }

        changes.push({
          path: file.file,
          type: changeType,
          diff,
          content,
        });

        this.logger.debug("Processed commit file", {
          file: file.file,
          type: changeType,
          insertions: textFile.insertions || 0,
          deletions: textFile.deletions || 0,
        });
      }

      const result = {
        commitHash: commit.hash,
        commitMessage: commit.message,
        author: commit.author_name,
        date: commit.date,
        changes,
      };

      this.logger.logServiceResponse("GitService", "getLastCommitChanges", {
        commitHash: commit.hash.substring(0, 8),
        fileCount: changes.length,
        author: commit.author_name,
      });

      return result;
    } catch (error) {
      this.logger.logError("getLastCommitChanges", error);
      throw new Error(`Failed to get last commit changes: ${error}`);
    }
  }
}
