# RPW 65 Changelog

### [1.5.3] - 2025-04-30

#### Added:
* 64TASS [from agurtovoy]: All supported CPUs in .cpu syntax
* 64TASS: Support for unspecified values (".byte ?", for example) in .structs
* 64TASS: Support lower word, higher word, and lower byte swapped word operators

#### Fixed:
* 64TASS: Change bank byte operator from "^" to "`"
* DASM: Macros are case insensitive, unlike symbols

### [1.5.2] - 2025-04-14

#### Added:
* All: Add base srcDir to include path search
* CA65: Anonymous .enum parsing, implicit values
* CA65: Symbol size prefix parsing

#### Fixed:
* All: MVN and MVP expression parsing
* All: COP param parsing when # is missing
* All: Tracking of macro file indexes
* All: "jsr (symbol,x)" addressing when symbol is imported
* CA65: Multiple .export parsing

### [1.5.1] - 2025-04-07

#### Fixed:
* MERLIN: Default symbol case sensitivity to true, not false, per docs

### [1.5.0] - 2025-04-04

Major rewrite of preprocessor to move it towards an actual multi-pass assembler.

#### Added:
* All: Support external symbol definition in project file
* All: Add per-syntax case sensitivity setting and support
* All: Warn on forward declared zpage variable treated as absolute
* All: Added support for wildcard in project module src property
* All: Report errors within macro expansions
* All: Syntax hilite macro/struct/enum type parameters
* CA65: Support indented @local: variables
* DASM: Support "(#expression)" syntax for immediate opcodes

#### Fixed:
* All: Fix variable scoping on loop/repeat/for
* All: Fix/limit scoping within macro definitions
* All: Fix crash with continuation "\" on last line of file
* All: Improved variable reference tracking in macro definitions and repeats
* CA65: String constants should be case insensitive (.setcpu "65c02", for example)
* CA65: Mark "LDA #-1" as a range error to match assembler
* DASM: Allow dc statements without data expressions

### [1.4.0] - 2024-11-22

Mainly the addition of 65816 and ORCA/M parsing and hiliting

#### Added:
* Parsing and hiliting of all 65816 and 65EL02 opcodes and addressing modes
* Preliminary ORCA/M (APW) syntax definition
* DASM: Brackets in place of parens

#### Fixed:
* All: Expression parsing crash on invalid hex values ("$XX", for example)
* DASM: Regression in handling of "#" prefix on pseudo-ops

### [1.3.2] - 2024-10-21

Updates to default syntax hiliting definitions in rpw65.tmLanguage.json

#### Added:

* All directives/pseudo ops
* Single quoted string pattern
* Corrected escape character pattern

### [1.3.1] - 2024-10-18

#### Added:

* ACME v.97: Support string escape characters, added since v.96
* ACME v.97: Warn on binary constants with digits that are not mod 8
* CA65: Support \x## string escapes

### [1.3.0] - 2024-10-17

Major rewrite of syntax parsing to move from an imperative implementation to a definition-driven one.

#### Added:
* Hover, auto complete and descriptions for all directives/pseudo ops
* 64tass syntax support
* Missing keywords and aliases for all syntaxes
* Improved auto-detect of syntax
* Support for parsing line continuations
* Many more test cases
* Many other fixes

### [1.2.2] - 2024-08-15

General collection of improvements, including Merlin additions so Prince of Persia sources parse cleanly-ish.

#### Added:
* Hovering over opcodes shows addressing modes, cycles counts, and flag effects.
* MERLIN: Leading "#" in data directive expressions
* MERLIN: DUM implicitly closes previous DUM
* MERLIN: XC off
* MERLIN: --^ for repeat end
* MERLIN: Leading "#" in EQU expressions
* MERLIN: Trailing ":" on opcodes to force 16-bit
* ACME: !src, !bin aliases for !source, !binary
* ACME: !macro definition parameters
* ACME: Anonymous locals ("+" and "-") in all expressions
* DASM: Allow segment without name
* DASM: Macro invoke parameter parsing
* DASM: Leading "#" on keywords
* CA65: Error on immediate/byte values -1 to -128
* CA65: Improved .import parsing/handling
* CA65: Error on double-quoted text in opcodes (CMP #"C", for example)
* All: Maintain local scope across equate assignment

#### Fixed:
* Macro definitions nested inside if/ifdef conditionals
* Syntax highlighting on file lost when included file is closed
* Syntax highlighting missing when file included multiple times
* Rename symbol to larger size sometimes consumes non-whitespace

### [1.2.1] - 2024-05-23

Minor changes, mainly to make Choplifter and Lode Runner disassemblies parse cleanly.

#### Added:
* CA65: Macro invoke in first column
* DASM,ACME: Space delimited HEX statements
* DASM: Leading "#" in EQU expressions
* DASM: Report extra spaces in "(ZP), Y", "(ZP, X)", etc. as errors

### [1.2.0] - 2024-05-08

This update includes a large batch of changes to get ACME and CA65 closer to parity with Merlin and DASM.
It also has changes to make highlighting more automatic, including detecting the syntax type from context and searching more aggressively for include files.

#### Added:
* Auto-detect of syntax by analyzing keywords and symbol names
* Show current syntax in status bar next to rpw65
* ACME: Scoped brace support for !zone, !macro, !pseudopc, !cpu, !for
* CA65: Support for .enum, .struct, .union, .proc, .scope
* Folding on macros, repeat loops, enums, structures, ACME brace blocks
* .l to list of supported file extensions for LISA 2 files
* Search for include file in current directory
* Recursively search for include files in all directories under workspace when no project file
* Throw exception when multiple .rpw-project files found in the workspace directory or JSON parsing fails
* CA65: full parsing of segment/code/data/bss, import/export, assert, etc.
* ALL: Full incbin and align argument parsing
* ALL: Repeat/loop parsing
* Settings to turn off errors and warnings

#### Fixed:
* Suppress completions on hex values and addressing mode endings
* Allow "label jmp label" while still flagging "label = label" as an error
* Stop hiliting operator words (mod, div, etc.) in red
* ACME: Parsing of parameters for macro define and invoke

#### Changed
* ACME: Suppress errors in braced inline code until parsing is supported
* ACME: Suppress errors in multi-statement lines until parsing is supported

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
