
// - provide symbol information so @DRAW_PICT works
// - support outline view

// - editing/tab handling (different for conditional statements)
// - tab modifier to move between columns
    // - control-tab? shift-control-tab?


// ? webpack for building extension
// ? script for building extension
// - folding groups on macro contents

// - hover/complete macro shows calling parameters and comments
// - signatureHelpProvider for macros

// CMD-P
    // @ function
    // # global search (first letter of each word)
    // > command
    // : line number
// Option up/down arrow to move lines

// git code lens
// paste json as code


// Language Server Ideas

// Features
// X renumber local labels
// * detect out of range branches
// X detect missing locals/labels
// - .dsk file as virtual file system

// Assembler
// - be smarter about generating .lst files with macro expansion

// symbols
    // constant versus dynamic symbol
    // make local prefix character a variable

// error issues
//  - syntax errors with specific information
//      - addressing mode not allowed, for example
//  X missing symbol
//  * branch out of range
//  X duplicate locals
//  X unused locals
//  - failing ERRs, when possible
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
//  - general hilite dimming of unused lables/constants/vars/etc.
//  * gray out disabled conditional clauses
//  X support collapsing code in else clauses
//  X hilite constants differently from other symbols
//  X hilite zpage differently than 16-bit symbols
//  X hilite local scope symbols as well as simple locals
//  X hilite ENT symbols differently than others
//  - hilite differently when only found in current source file
//  * hilite (underline?) branches that cross page boundaries
//  - hilite tables that cross pages
//
// auto-complete
//  X smart auto-complete based on instruction type
//      - constant (LDA #), zpage (LDA), or label (LDA, JSR)
//  - smart editing of auto-completes/snippets (more research)
//
// other
//  X jump to definition for functions and data storage
//  - jump to defitition (open file) on PUT file paths
//  ? use deprecated names to show renames for legacy functions
//

//  - option to allow or warn on symbols > 13 character merlin limit

//  X possible to auto-complete <space> to do full indent?
//      X take into consideration being within a comment

//  - warn on LDA <SYMBOL or >SYMBOL (missing #?)
//  ? warn on complex expressions on JSR/JMP/Bcc

//  X when using shared VARS.S file, show references across project
//  - add structure concept when parsing DUMMY <non-zero>

//  X track file shared across project as special (VAR.S)
    // X infer symbol types across project

//  - make syntax hiliting work on .lst files?

//  - logic to maintain columns while typing (comment-only?)

// *** don't show error on file-not-found for single files


// TODO (low-priority)
//  - add folding ranges for all non-local symbol scopes

// - hover over a label reference hilites definition?
//  - particularly for local labels?

// - hover over expression selection -- evaluate/resolve selection using parser


// - syntax hilite all if/else clauses in a macro definition
