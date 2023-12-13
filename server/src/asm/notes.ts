
// * rename of "LDA VAR_MOD+1" should not be padded with spaces
    // - maybe afterwards, before comment
// ? Don't delay document update when file is first opened
// * tab jumps too far when opcode > 3 characters
// * add some settings and handle them
// * Add Format Document and Format Selection support

// ? consider space instead of tab for indenting
    // - double-space to disambiguate for non-Merlin syntaxes

// * infer number of macro args and enforce on invocation

// ? correctly mark zpage used only by other zpages (ZBLOCK_A0+0)
// * scan back from storage opcodes to mark labels as data
//   (So "LABEL HEX" split into two lines still works)

// - when a file goes from inside a project to out, fully rebuild
//  (comment out a file in an ASM. file, for example)

// - add 65C02 support

// - complete MAC with EOM
// - don't gray out conditional code in macro defs
// - do allow symbol references (but not defs) in macro defs

// - add ABS,X and ABS,Y completions

// - fix watch tab width (in dbug)
// * fix ";" in macro treated as comment in dbug/CodeMirror

// - fix more dbug/CodeMirror syntax colors
// - more tmLanguage hiliting, including other syntax keywords

// ? adjust line height to more closely match dbug

// ? show all completions on invoked completion

// - show file name instead of "details" in completion

// - selecting gap between ; and STA and tab does nothing
//  ";   STA	SERIAL,Y"

// - selecting tabs between
//  "ARM_EVEN		HEX	80402A552A552A552A552A552A552A552A000000"

// - convert tabs to spaces to tab columns work enough to fix tabs


// editor tab size
// editor insert spaces
// editor indent size
// editor detect indentation
// editor use tab stops

// auto-detect project settings, store in workspace?
    // syntax
    // opcode case
    // keyword case?
    // tab-stops

// - provide symbol information so @DRAW_PICT works
// - support outline view

// - folding groups on macro contents
// - folding on zone borders
// - add folding ranges for all non-local symbol scopes

// - hover/complete macro shows calling parameters and comments
// - signatureHelpProvider for macros


// Features
// + detect out of range branches
// - .dsk file as virtual file system

// Assembler
// + be smarter about generating .lst files with macro expansion

// symbols
    // - constant versus dynamic symbol
    // - make local prefix character a variable

// error issues
//  - syntax errors with specific information
//  + branch out of range
//  + failing ERRs, when possible
//
// features
//  - add cycle counts as comments on selected lines
//      - with  2/3 branches and totals
//      - maybe with indentation
//      - mark page-crossing branches
//  ? toggle number constant values between formats (#,$,%)
//      ? apply to an entire selection
//
// code completion
//  X symbols names (labels and/or constants, depending on context)
//  X show full function header information (onCompletionResolve?)
//
// snippets
//  ? auto complete '(' as '(xxx),Y'
//  - On entry/exit header
//
// hover
//  - parse "On entry:" and "On exit:" for more specific intellisense
//  - show other constants in same set as current
//  X show values constants actual values
//  X show ZPAGE variable addresses
//  - show "DUM 0" defined structure/offsets
//
// syntax hiliting
//  ? hilite differently when only found in current source file
//  + hilite (underline?) branches that cross page boundaries
//      - draw line breaks on each memory page boundary
//  + hilite tables that cross pages
//
// auto-complete
//  ? smart editing of auto-completes/snippets (more research)
//
// other
//  - jump to definition (open file) on PUT file paths
//  ? use deprecated names to show renames for legacy functions
//

//  ? option to allow or warn on symbols > 13 character merlin limit

//  - warn on LDA <SYMBOL or >SYMBOL (missing #?)
//  ? warn on complex expressions on JSR/JMP/Bcc

//  X when using shared VARS.S file, show references across project
//  - add structure concept when parsing DUMMY <non-zero>

//  X track file shared across project as special (VAR.S)
    // X infer symbol types across project

//  - make syntax hiliting work on .lst files?

//  X logic to maintain columns while typing (comment-only?)



// ? hover over a label reference hilites definition?
//  ? particularly for local labels?

// - hover over expression selection -- evaluate/resolve selection using parser

// - syntax hilite all if/else clauses in a macro definition
