# RPW 65 Changelog

### [1.1.0] - 2023-12-19

#### Added:
* 65C02 opcode support
* Non-Merlin: Allow ';' comment without preceding whitespace
* ACME: Fill in several missing text, disk, and conditional keywords
* DASM: Support SET and variables
* DASM: Support SEG.U
* DASM: Treat single '.' the same as '*'
* DASM: Allow trailing ':' on labels
* DASM: Support BYTE and WORD without leading '.' and without arguments

#### Fixed:
* Don't add padding after a shrinking renamed symbol if in the middle of an expression
* Non-Merlin: Strip quotes off include file names

#### Changed:
* Moved settings out of project file and into VSCode workspace settings
* Updated documentation images

### [1.0.0] - 2023-12-13

#### Fixed:
* Paren and brace parsing for non-Merlin syntaxes
* Elseif conditional handling
* Put/include directory parsing exception while editing

#### Changed:
* Moved project settings under a common property in project file
* Updated documentation images
* Updated descriptions for project properties in README

### [0.9.0] - 2023-11-30

#### Added:
* Multi-syntax parsing
* Semantic syntax hiliting
* Auto-completion
* Symbol hover/tooltips
* Syntax errors and warnings
* Go To Definition and References
* Rename Symbol
* Renumber Locals

Contains extensive support for Merlin syntax, with initial basic support for DASM, CA65, ACME, and LISA2.5.
