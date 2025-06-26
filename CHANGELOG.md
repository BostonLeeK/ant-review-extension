# Change Log

All notable changes to the "code-review" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2] - 2024-01-11

### Fixed

- **API Key Persistence**: Claude API key now automatically loads on extension restart
- **UI State**: Shows masked saved API key with reactivation option
- **Initialization**: Auto-initializes Claude service from saved configuration
- **VSCode Compatibility**: Lowered minimum version requirement to 1.96.0

### Improved

- Better user feedback when API key is saved but needs reactivation
- Enhanced error handling for corrupted configurations

## [0.0.1] - 2024-01-11

### Added

- Initial release of Ant Review Assistant
- AI-powered code analysis with Anthropic Claude integration
- ANT (Abstract Node Tree) static code analysis
- Linter integration with VSCode diagnostics
- Git integration for automatic change detection
- Modern webview interface similar to AntReview
- File-by-file analysis capability
- Real-time results with clickable issues
- Secure API key storage
- Parallel analysis pipeline for optimal performance

### Features

- **Claude AI Analysis**: Intelligent code review using claude-3-haiku-20240307
- **Static Analysis**: Custom ANT analyzer for code quality checks
- **Linting Integration**: VSCode diagnostics and custom linting rules
- **Git Operations**: Automatic detection of staged and unstaged changes
- **Interactive UI**: Clean, modern interface with VSCode theming
- **Navigation**: Click issues to jump to specific lines in editor
- **Scoring System**: 0-10 code quality scores for each file
- **Multi-source Results**: Combined analysis from multiple analyzers

### Commands

- `code-review.openPanel`: Opens the main Ant Review panel
- `code-review.refreshChanges`: Refreshes the Git changes list

### Architecture

- Clean architecture with dependency injection
- Modular design with separate services and analyzers
- TypeScript implementation with strict typing
- Webpack bundling for optimal performance
- Professional error handling and logging

### Requirements

- VSCode 1.101.0+
- Node.js 20.x
- Git repository
- Claude API key from Anthropic

### Known Limitations

- Currently supports text-based files only
- Requires internet connection for Claude analysis
- Git repository is required for change detection
