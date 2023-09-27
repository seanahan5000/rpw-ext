
// Language Server Ideas

// Features
// X renumber local labels
// * detect out of range branches
// * detect missing locals/labels
// - .dsk file as virtual file system

// Parser
// - maybe build statements in tree form to handle conditionals and macros

// Assembler
// - be smarter about generating .lst files with macro expansion

// General
// - more thorough support for different assembler syntaxes
//   - merlin, dasm, acme?, cc65?
//     - ':' or '.' for locals
//     - ']' for vars (merlin-only)
//     - '+' and '-' for anonymous branch directions, ':' for anon label
//     - ':' at end of label definition
//   - think about how that affects parsing
//   - will also affect language server (label scoping, for example)
// - consider .proc and .scope from ca65
//   - support in assembler
// - consider .charmap instead of custom Naja text?
// - multiple passes?

// symbols
    // use a scope hierarchy
        // local (last non-local, last dasm subroutine, last .proc/.scope)
        // global
    // constant versus dynamic symbol
    // constants that influence conditionals
    // make local prefix character a variable
    // optionally support trailing ':' on labels
        // (what does lack of ':' mean?)

// error issues
//  - syntax errors with specific information
//      - addressing mode not allowed, for example
//  - missing symbol
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
//  - track/hilite unused labels and zpage vars
//
// code completion
//  * symbols names (labels and/or constants, depending on context)
//  X show full function header information (onCompletionResolve?)
//
// snippets
//  - auto complete '(' as '(xxx),Y'
//  - On entry/exit header
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
//  - gray out disabled conditional clauses
//  - support collapsing code in else clauses
//  - hilite constants differently from other symbols
//  - hilite zpage differently than 16-bit symbols
//  - hilite local scope symbols as well as simple locals
//  - hilite ENT symbols differently than others
//  - hilite differently when only found in current source file
//  * hilite (underline?) branches that cross page boundaries
//  - hilite tables that cross pages
//
// auto-complete
//  - smart auto-complete based on instruction type
//      - constant (LDA #), zpage (LDA), or label (LDA, JSR)
//  - smart editing of auto-completes/snippets (more research)
//
// other
//  X jump to definition for functions and data storage
//  - jump to defitition (open file) on PUT file paths
//  ? use deprecated names to show renames for legacy functions
//  - upper/lower case setting
//

//  - marking unused locals with syntax coloring rather than yellow underline?
//  - option to allow or warn on symbols > 13 character merlin limit

//  X possible to auto-complete <space> to do full indent?
//      X take into consideration being within a comment

//  - warn on LDA <SYMBOL or >SYMBOL (missing #?)
//  ? warn on complex expressions on JSR/JMP/Bcc

//  - rename a single local

//  - generate real > groupings and turn off defaults

//  - when using shared VARS.S file, show references across project
//  - add structure concept when parsing DUMMY <non-zero>

//  - track file shared across project as special (VAR.S)
    // - infer symbol types across project

//  - make syntax hiliting work on .lst files?

//  - logic to maintain columns while typing (comment-only?)

// *** don't hilite macros until macro has been seen
    // *** only "light up" and colorize known information

// *** don't show error on file-not-found for single files


// TODO (low-priority)
//  - add folding ranges for all non-local symbol scopes

// - hover over a label reference hilites definition?
//  - particularly for local labels?
