
// X fix ]var labels for POP
// - add ABS,X and ABS,Y completions

// - fix TXT, TXC, TXI hiliting

// - fix watch tab width (in dbug)

// - fix more dbug/CodeMirror syntax colors
// - more tmLanguage hiliting, including other syntax keywords

// ? adjust line height to more closely match dbug

// ? show all completions on invoked completion

// - show file name instead of "details" in completion

// - when a file goes from inside a project to out, fully rebuild
//  (comment out a file in an ASM. file, for example)

// - selecting gap between ; and STA and tab does nothing
//  ";   STA	SERIAL,Y"

// - selecting tabs between
//  "ARM_EVEN		HEX	80402A552A552A552A552A552A552A552A000000"

// - convert tabs to spaces to tab columns work enough to fix tabs

// - scan back from storage opcodes to mark labels as data
//   (So "LABEL HEX" split into two lines still works)


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

// build vsix for release
// "vscode:prepublish": "npm run esbuild-base -- --minify",
//  npm run compile
//  (npm run esbuild)
//  vsce package
// - Add repository and license

// - folding groups on macro contents
// - folding on zone borders
// - add folding ranges for all non-local symbol scopes

// - hover/complete macro shows calling parameters and comments
// - signatureHelpProvider for macros

// CMD-P
    // @ function
    // # global search (first letter of each word)
    // > command
    // : line number
// Option up/down arrow to move lines


// Language Server Ideas

// Features
// X renumber local labels
// + detect out of range branches
// X detect missing locals/labels
// - .dsk file as virtual file system

// Assembler
// + be smarter about generating .lst files with macro expansion

// symbols
    // - constant versus dynamic symbol
    // - make local prefix character a variable

// error issues
//  - syntax errors with specific information
//      - addressing mode not allowed, for example
//  X missing symbol
//  + branch out of range
//  X duplicate locals
//  X unused locals
//  + failing ERRs, when possible
//
// features
//  X renumber locals
//  X rename :SKIPA, :LOOP1 to numbered locals
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
//  X PictEnd after JSR DRAW_PICT
//
// hover
//  X show comment block for function name
//  - parse "On entry:" and "On exit:" for more specific intellisense
//  - show other constants in same set as current
//  - show values constants actual values
//  - show ZPAGE variable addresses
//  - show "DUM 0" defined structure/offsets
//
// syntax hiliting
//  X general hilite dimming of unused lables/constants/vars/etc.
//  X gray out disabled conditional clauses
//  X support collapsing code in else clauses
//  X hilite constants differently from other symbols
//  X hilite zpage differently than 16-bit symbols
//  X hilite local scope symbols as well as simple locals
//  X hilite ENT symbols differently than others
//  ? hilite differently when only found in current source file
//  + hilite (underline?) branches that cross page boundaries
//  + hilite tables that cross pages
//
// auto-complete
//  X smart auto-complete based on instruction type
//      X constant (LDA #), zpage (LDA), or label (LDA, JSR)
//  ? smart editing of auto-completes/snippets (more research)
//
// other
//  X jump to definition for functions and data storage
//  - jump to defitition (open file) on PUT file paths
//  ? use deprecated names to show renames for legacy functions
//

//  ? option to allow or warn on symbols > 13 character merlin limit

//  X possible to auto-complete <space> to do full indent?
//      X take into consideration being within a comment

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
