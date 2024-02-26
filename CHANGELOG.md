# RPW 65 Changelog

### [1.1.3] - 2024-02-26

#### Added:
* .a to list of supported file extensions
* Brackets in place of parens (always allowed, to be connected to syntax feature later)
* CA65: Anonymous ":", ":+", ":-" labels
* CA65: Indented assignment
* CA65: ":=" assignment
* CA65: .set variables
* CA65: Better scoping of macro parameters and symbols
* CA65: More keywords and directives
* DASM: Optional "." or "#" prefix on all directives
* DASM: Error if "A" present on accumulator mode shift and rotation opcodes
* DASM: Parsing of forced addressing mode suffixes on opcodes

#### Fixed:
* Loading default settings from project
* Tabbing in the middle of a word, across a tabstop, sometimes overwrites a character instead of inserting space
* Crash caused by circular symbol reference (label = label)
* Auto-completion of keywords starting with symbol
* CA65: Parsing of quoted file paths

### [1.1.2] - 2024-02-04

#### Added:
* .inc to list of supported file extensions
* CA65: Missing common keywords
* CA65: Support for keywords at character column 1

### [1.1.1] - 2024-01-02

#### Fixed:
* Disable variable tab indentation while in snippet or completion mode (Issue #1)
* Add setting to disable variable tab indentation completely (rpw.columns.enable)
* Renaming a symbol to exactly the label column width doesn't pad with a space before the opcode column
* Don't insert ';' on tab when already in comment
* Tab jumps too far when label or opcode are larger than their respective widths

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
