# Ant Review Assistant

AI-powered code review plugin for VSCode with Claude integration, ANT analysis, and linting.

## Features

- **AI Analysis**: Powered by Anthropic Claude for intelligent code review
- **ANT Analysis**: Abstract Node Tree analysis for code quality checks
- **Linter Integration**: Uses VSCode's built-in diagnostics and custom linting rules
- **Git Integration**: Automatically detects staged and unstaged changes
- **Interactive UI**: Modern webview interface similar to AntReview
- **File-by-file Analysis**: Review each changed file independently
- **Real-time Results**: Click on issues to jump to specific lines

## Installation

1. Clone this repository
2. Install dependencies: `npm install`
3. Compile the extension: `npm run compile`
4. Press F5 to run the extension in a development window

## Usage

### 1. Initial Setup

1. Open the extension development window (F5)
2. Open a Git repository with some changes
3. Run the command: `Open Ant Review` from the Command Palette (Ctrl+Shift+P)

### 2. Configure Claude API Key

1. In the Ant Review panel, enter your Claude API key
2. Click "Set API Key" to save the configuration
3. **The key is stored securely in VSCode's global state and persists between sessions**
4. If you see a masked API key (sk-1234...xyz), the key is saved but needs reactivation

### 3. Review Your Changes

1. The extension will automatically detect Git changes (staged and unstaged)
2. Click "Refresh Changes" to update the file list
3. Click on any file to analyze it individually
4. Click "Analyze All Files" to review all changes at once

### 4. Review Results

- **Errors**: Critical issues that should be fixed (red border)
- **Warnings**: Important suggestions (yellow border)
- **Info**: Style and best practice recommendations (blue border)
- **Score**: Overall code quality score (0-10)
- **Sources**: Issues marked by source (claude, ant, linter)

Click on any issue to jump to the specific line in the editor.

## Architecture

The extension is built with clean architecture principles:

### Core Components

- **Extension.ts**: Main entry point and dependency injection
- **CodeReviewProvider**: Manages the webview panel and coordinates services
- **GitService**: Handles Git operations and change detection
- **ClaudeService**: Manages AI analysis using Anthropic Claude
- **ANTAnalyzer**: Performs static code analysis
- **LinterAnalyzer**: Integrates with VSCode diagnostics

### Analysis Pipeline

1. **Git Detection**: Finds staged/unstaged changes
2. **File Content**: Reads file content and diffs
3. **Parallel Analysis**: Runs Claude, ANT, and Linter analysis simultaneously
4. **Result Combination**: Merges results from all analyzers
5. **UI Update**: Displays results in the webview

## Configuration

### Claude Models

The extension currently uses `claude-3-haiku-20240307` for analysis. You can modify the model in `ClaudeService.ts` if needed.

### Analysis Rules

#### ANT Analyzer Checks:

- Line length (>120 characters)
- Function complexity and nesting
- Naming conventions
- Code structure and organization
- Error handling patterns
- Security vulnerabilities

#### Linter Analyzer Checks:

- VSCode diagnostics integration
- Common ESLint rules simulation
- Code quality patterns
- Style consistency

## Development

### Project Structure

```
src/
├── extension.ts                 # Main extension entry
├── types/
│   └── index.ts                # Type definitions
├── services/
│   ├── GitService.ts           # Git operations
│   └── ClaudeService.ts        # AI analysis
├── analyzers/
│   ├── ANTAnalyzer.ts          # Static analysis
│   └── LinterAnalyzer.ts       # Linting integration
└── providers/
    └── CodeReviewProvider.ts   # Webview management
```

### Building

```bash
npm install          # Install dependencies
npm run compile     # Compile TypeScript
npm run watch       # Watch mode for development
npm run package     # Production build
```

### Testing

```bash
npm run test        # Run tests
npm run lint        # Run ESLint
```

## Requirements

- VSCode 1.96.0 or higher
- Node.js 20.x
- Git repository with changes
- Claude API key from Anthropic

## Extension Commands

- `code-review.openPanel`: Open the Ant Review panel
- `code-review.refreshChanges`: Refresh the changes list

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Troubleshooting

### Common Issues

**"Claude not initialized"**

- Ensure you've entered a valid Claude API key
- Check your internet connection
- If you see a masked API key, click "Set API Key" to reactivate
- Try refreshing the Ant Review panel

**"No changes found"**

- Make sure you're in a Git repository
- Try making some changes and staging them

**"Analysis failed"**

- Check the Developer Console (Help > Toggle Developer Tools)
- Verify the API key is correct
- Ensure files are accessible

### Debug Mode

Press F5 to run the extension in debug mode with:

- Console logging in the Extension Development Host
- Breakpoint debugging support
- Hot reload for development changes
