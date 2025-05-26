
import { SyntaxDef, KeywordDef, FunctionDef, ParamDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"
import * as fnc from "../functions"

//------------------------------------------------------------------------------
// CA65
//------------------------------------------------------------------------------
//  Precedence:
//    https://cc65.github.io/doc/ca65.html#ss5.5
//
//    NOTE: precedence reversed from 0->7 to 8->1
//------------------------------------------------------------------------------

export class Ca65Syntax extends SyntaxDef {

  public caseSensitiveSymbols = true
  public symbolTokenPrefixes = ".@"
  public symbolTokenContents = ""
  public cheapLocalPrefixes = "@"
  public zoneLocalPrefixes = ""
  public anonLocalChars = ""
  public namedParamPrefixes = ""
  public keywordPrefixes = "."
  public keywordsInColumn1 = true
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ","
  public allowLabelTrailingColon = true
  public allowIndentedAssignment = true
  public allowLineContinuation = true
  public stringEscapeChars = "\\'\"tnrx"
  public scopeSeparator = "::"
  public defaultOrg = undefined

  // *** TODO: pseudo functions separately? ***

  constructor() {
    super()

    this.paramDefMap = new Map<string, ParamDef>([
      [ "import-type", { params: "{far|direct|absolute|zeropage}" } ],
      [ "import-def",  { params: "<symbol-weakdef>[:<import-type>]" } ],
      [ "export-def",  { params: "<symbol>[:<import-type>]" } ],
      [ "assert-type", { params: "{warning|error|ldwarning|lderror}" } ],
      [ "feature-name",{ params: "{at_in_identifiers|bracket_as_indirect|c_comments|dollar_in_identifiers|dollar_is_pc|force_range|labels_without_colons|leading_dot_in_identifiers|line_continuations|long_jsr_jmp_rts|loose_char_term|loose_string_term|missing_char_term|org_per_seg|pc_assignment|string_escapes|ubiquitous_idents|underline_in_numbers}" } ]
    ])

    this.keywordMap = new Map<string, KeywordDef>([

      // target
      [ ".setcpu",    { // TODO
                        params: '{"6502"|"65c02"|"65816"}',
                        desc:   "Switch the CPU instruction set" } ],
      [ ".pushcpu",   { // TODO
                        params: "",
                        desc:   "Push the currently active cpu onto a stack" } ],
      [ ".popcpu",    { // TODO
                        params: "",
                        desc:   "Pop the last pushed cpu from the stack and activate it" } ],

      // equates
      [ "=",          { create: () => { return new stm.EquStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Assign value to symbol" } ],
      [ ":=",         { create: () => { return new stm.EquStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Assign value to symbol as a label" } ],
      [ ".set",       { create: () => { return new stm.VarAssignStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Assign a value to a variable" } ],

      // pc
      [ ".org",       { create: () => { return new stm.OrgStatement() },
                        params: "<expression>",
                        desc:   "Start a section of absolute code" } ],
      [ ".reloc",     { // TODO
                        params: "",
                        desc:   "Switch back to relocatable mode" } ],

      // disk
      [ ".include",   { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Include another file" } ],
      [ ".incbin",    { create: () => { return new stm.IncBinStatement() },
                        params: "<filename>[, <offset> [, <size>]]",
                        desc:   "Include a file as binary data" } ],

      // macros
      [ ".macro",     { create: () => { return new stm.MacroDefStatement() },
                        params: "<macro-name> [<type-param> [, <type-param> ...]]",
                        desc:   "Start a classic macro definition" } ],
      [ ".mac",       { alias: ".macro" }],
      [ ".endmacro",  { create: () => { return new stm.EndMacroDefStatement() },
                        params: "",
                        desc:   "Marks the end of a macro definition" } ],
      [ ".endmac",    { alias: ".endmacro" }],
      [ ".exitmacro", { // TODO
                        params: "",
                        desc:   "Abort a macro expansion immediately" } ],
      [ ".exitmac",   { alias: ".exitmacro" }],
      [ ".macpack",   { // TODO
                        params: "{atari|cbm|cpu|generic|longbranch}",
                        desc:   "Insert a predefined macro package" } ],
      [ ".delmacro",  { // TODO
                        params: "<macro-name>",
                        desc:   "Delete a classic macro" } ],
      [ ".delmac",    { alias: ".delmacro" }],

      [ ".define",    { create: () => { return new stm.DefineDefStatement() },
                        params: "<define-name>[( [<define-param>[, <define-param> ...]] )] <expression>[, <expression> ...]",
                        desc:   "Start a define style macro definition" } ],
      [ ".undefine",  { // TODO
                        params: "<define-name>",
                        desc:   "Delete a define style macro definition" } ],
      [ ".undef",     { alias:  ".undefine" } ],

      // data storage
      // *** TODO: check all signed/unsigned limits ***
      [ ".byte",      { create: () => { return new stm.DataStatement_U8() },
                        params: "[<string-value>[, <string-value> ...]]",
                        desc:   "Define byte sized data" } ],
      [ ".byt",       { alias: ".byte" }],
      [ ".dbyt",      { create: () => { return new stm.DataStatement_U16(true) },
                        params: "[<expression>[, <expression> ...]]",
                        desc:   "Define word sized data with the hi and lo bytes swapped" } ],
      [ ".word",      { create: () => { return new stm.DataStatement_U16() },
                        params: "[<expression>[, <expression> ...]]",
                        desc:   "Define word sized data" } ],
      [ ".addr",      { create: () => { return new stm.DataStatement_U16() },
                        params: "[<expression>[, <expression> ...]]",
                        desc:   "Define word sized data" } ],
      [ ".faraddr",   { create: () => { return new stm.DataStatement_U24() },
                        params: "[<expression>[, <expression> ...]]",
                        desc:   "Define far (24 bit) address data" } ],
      [ ".dword",     { create: () => { return new stm.DataStatement_U32() },
                        params: "[<expression>[, <expression> ...]]",
                        desc:   "Define dword sized data" } ],
      [ ".lobytes",   { // TODO
                        params: "<expression>[, <expression> ...]",
                        desc:   "Define byte sized data by extracting only the low byte " } ],
      [ ".hibytes",   { // TODO
                        params: "<expression>[, <expression> ...]",
                        desc:   "Define byte sized data by extracting only the low byte " } ],
      [ ".bankbytes", { // TODO
                        params: "<expression>[, <expression> ...]",
                        desc:   "Define byte sized data by extracting only the bank byte " } ],

      [ ".res",       { create: () => { return new stm.StorageStatement(1) },
                        params: "<count>[, <fill>]",
                        desc:   "Reserve storage" } ],
      [ ".tag",       { create: () => { return new stm.TagStatement() },
                        params: "<type-ref>",
                        desc:   "Allocate space for a struct or union" } ],
      [ ".align",     { create: () => { return new stm.AlignStatement() },
                        params: "<boundary>",
                        desc:   "Align data to a given boundary" } ],

      // conditionals
      [ ".if",        { create: () => { return new stm.IfStatement() },
                        params: "<condition>",
                        desc:   "Assemble block if expression is true" } ],
      [ ".ifdef",     { create: () => { return new stm.IfDefStatement(true) },
                        params: "<symbol-weakref>",
                        desc:   "Assemble block if symbol is defined" } ],
      [ ".ifndef",    { create: () => { return new stm.IfDefStatement(false) },
                        params: "<symbol-weakref>",
                        desc:   "Assemble block if symbol is not defined" } ],
      [ ".ifblank",   { // TOOD
                        params: "<expression>",
                        desc:   "Assemble block if there are remaining tokens in expression" } ],
      [ ".ifnblank",  { // TOOD
                        params: "<expression>",
                        desc:   "Assemble block if there are not remaining tokens in expression" } ],
      [ ".ifconst",   { create: () => { return new stm.IfConstStatement(true) },
                        params: "<condition>",
                        desc:   "Assemble block if expression is constant" } ],
      [ ".ifref",     { // TOOD
                        params: "<symbol>",
                        desc:   "Assemble block if symbol is referenced" } ],
      [ ".ifnref",    { // TOOD
                        params: "<symbol>",
                        desc:   "Assemble block if symbol is not referenced" } ],
      [ ".else",      { create: () => { return new stm.ElseStatement() },
                        params: "",
                        desc:   "Reverse the current condition" } ],
      [ ".elseif",    { create: () => { return new stm.ElseIfStatement() },
                        params: "<condition>",
                        desc:   "Reverse current condition and test a new one" } ],
      [ ".endif",     { create: () => { return new stm.EndIfStatement() },
                        params: "",
                        desc:   "Close .if or .else branch" } ],
      [ ".end",       { // TOOD
                        params: "",
                        desc:   "Forced end of assembly" } ],

      // looping
      [ ".repeat",    { create: () => { return new stm.RepeatStatement() },
                        params: "<loop-count>[, <loop-var>]",
                        desc:   "Repeat commands a constant number of times." } ],
      [ ".endrepeat", { create: () => { return new stm.EndRepStatement() },
                        params: "",
                        desc:   "End a .repeat block" } ],
      [ ".endrep",    { alias:  ".endrepeat" } ],

      // import/export
      [ ".import",    { create: () => { return new stm.ImportExportStatement(false, false) },
                        params: "<import-def>[, <import-def> ...]",
                        desc:   "Import a symbol from another module" } ],
      [ ".importzp",  { create: () => { return new stm.ImportExportStatement(false, true) },
                        params: "<symbol-weakdef>[, <symbol-weakdef> ...]",
                        desc:   "Import a symbol from another module as zpage" } ],
      [ ".forceimport",{ // TODO
                        params: "<import-def>[, <import-def> ...]",
                        desc:   "Import an absolute symbol from another module" } ],
      [ ".export",    { create: () => { return new stm.ImportExportStatement(true, false) },
                        // TODO: more possibilities
                        params: "<export-def>[ {=|:=} <expression>][, <export-def>[ {=|:=} <expression>] ...]",
                        desc:   "Make symbols accessible from other modules" } ],
      [ ".exportzp",  { create: () => { return new stm.ImportExportStatement(true, true) },
                        params: "<symbol>[ {=|:=} <expression>][, <symbol> [{=|:=} <expression>] ...]",
                        desc:   "Make symbols accessible from other modules" } ],
      [ ".global",    { // TODO
                        params: "<symbol>[, <symbol> ...]",
                        desc:   "Declare symbols as global" } ],
      [ ".globalzp",  { // TODO
                        params: "<symbol>[, <symbol> ...]",
                        desc:   "Declare symbols as global zpage" } ],
      [ ".autoimport",{ // TODO
                        params: "[+]",
                        desc:   "Enable undefined symbols automatically marked as import instead of errors" } ],
      [ ".condes",    { // TODO
                        params: "<symbol>[,{ {constructor|destructor|interruptor} | <type> } [, <value>] ]",
                        desc:   "Export a symbol and mark it in a special way" } ],
      [ ".constructor",{ // TODO
                        params: "<symbol>[, <priority>]",
                        desc:   "Export a symbol and mark it as a module constructor" } ],
      [ ".destructor",{ // TODO
                        params: "<symbol>[, <priority>]",
                        desc:   "Export a symbol and mark it as a module destructor" } ],
      [ ".interruptor",{ // TODO
                        params: "<symbol>[, <priority>]",
                        desc:   "Export a symbol and mark it as an interruptor" } ],

      // segments
      [ ".segment",   { create: () => { return new stm.SegmentStatement() },
                        params: "<string>[: {zeropage|absolute|direct}]",
                        desc:   "Switch to another segment" } ],
      [ ".code",      { create: () => { return new stm.SegmentStatement("CODE") },
                        params: "",
                        desc:   "Switch to the CODE segment" } ],
      [ ".data",      { create: () => { return new stm.SegmentStatement("DATA") },
                        params: "",
                        desc:   "Switch to the DATA segment" } ],
      [ ".bss",       { create: () => { return new stm.SegmentStatement("BSS") },
                        params: "",
                        desc:   "Switch to the BSS segment" } ],
      [ ".zeropage",  { create: () => { return new stm.SegmentStatement("ZEROPAGE") },
                        params: "",
                        desc:   "Switch to the ZEROPAGE segment" } ],
      [ ".rodata",    { create: () => { return new stm.SegmentStatement("RODATA") },
                        params: "",
                        desc:   "Switch to the RODATA segment" } ],
      [ ".pushseg",   { // TODO
                        params: "",
                        desc:   "Push the currently active segment onto a stack" } ],
      [ ".popseg",    { // TODO
                        params: "",
                        desc:   "Pop the last pushed segment from the stack and set it" } ],

      // C-types
      [ ".enum",      { create: () => { return new stm.EnumStatement() },
                        params: "[<type-name>]",
                        desc:   "Start an enumeration" } ],
      [ ".endenum",   { create: () => { return new stm.EndEnumStatement() },
                        params: "",
                        desc:   "End a .enum declaration" } ],
      [ ".struct",    { create: () => { return new stm.StructStatement() },
                        params: "[<type-name>]",
                        desc:   "Start a struct definition" } ],
      [ ".endstruct", { create: () => { return new stm.EndStructStatement() },
                        params: "",
                        desc:   "End a struct definition" } ],
      [ ".union",     { create: () => { return new stm.UnionStatement() },
                        params: "[<type-name>]",
                        desc:   "Start a union definition" } ],
      [ ".endunion",  { create: () => { return new stm.EndUnionStatement() },
                        params: "",
                        desc:   "End a union definition" } ],

      // scope
      [ ".scope",     { create: () => { return new stm.ScopeStatement() },
                        params: "<type-name>",
                        desc:   "Start a nested lexical level with the given name" } ],
      [ ".endscope",  { create: () => { return new stm.EndScopeStatement() },
                        params: "",
                        desc:   "End of the local lexical level" } ],
      [ ".proc",      { create: () => { return new stm.ProcStatement() },
                        params: "<type-name>",
                        desc:   "Start a nested lexical level with the given name and add symbol" } ],
      [ ".endproc",   { create: () => { return new stm.EndProcStatement() },
                        params: "",
                        desc:   "End of the local lexical level" } ],

      // text
      [ ".asciiz",    { // TODO
                        params: "<string>[, <string> ...]",
                        desc:   "Define a string with a trailing zero." } ],
      [ ".literal",   { // TODO
                        params: "<string-value>[, <string-value> ...]",
                        desc:   "Define byte sized data, string disregard mapping definition" } ],

      [ ".charmap",   { // TODO
                        params: "<index>, <mapping>",
                        desc:   "Apply a custom mapping for characters for the commands .ASCIIZ and .BYTE" } ],
      [ ".pushcharmap",{ // TODO
                        params: "",
                        desc:   "Push the currently active character mapping onto a stack" } ],
      [ ".popcharmap",{ // TODO
                        params: "",
                        desc:   "Pop the last pushed character mapping from the stack and activate it" } ],

      // messages
      [ ".assert",    { create: () => { return new stm.AssertTrueStatement() },
                        params: "<condition>, <assert-type> [,<string>]",
                        desc:   "Add an assert" } ],
      [ ".error",     { create: () => { return new stm.AssertTrueStatement("error", true) },
                        params: "<expression>",   // TODO: <string> later
                        desc:   "Force an assembly error" } ],
      [ ".fatal",     { create: () => { return new stm.AssertTrueStatement("fatal", true) },
                        params: "<expression>",   // TODO: <string> later
                        desc:   "Force an assembly error and terminate assembly" } ],
      [ ".warning",   { create: () => { return new stm.AssertTrueStatement("warning", true) },
                        params: "<expression>",   // TODO: <string> later
                        desc:   "Force an assembly warning" } ],
      [ ".out",       { // TODO
                        params: "<expression>",   // TODO: <string> later
                        desc:   "Output a string to the console without producing an error" } ],

      [ ".fileopt",   { // TODO
                        params: "{author|comment|compiler}, <string>",
                        desc:   "Insert an option string into the object file" } ],
      [ ".fopt",      { alias: ".fileopt" }],

      // formatting
      [ ".list",      { // TODO
                        params: "{on|off|+|-}",
                        desc:   "Enable output to the listing" } ],
      [ ".listbytes", { // TODO
                        params: "{unlimited|<expression>}",
                        desc:   "Set how many bytes are shown in the listing for one source line" } ],
      [ ".pagelength",{ // TODO
                        params: "{unlimited|<expression>}",
                        desc:   "Set the page length for the listing" } ],
      [ ".pagelen",   { alias: ".pagelength" } ],

      [ ".local",     { // TODO
                        params: "<symbol>[, <symbol> ...]",
                        desc:   "Declare a list of identifiers as local to the macro expansion" } ],

      // misc
      [ ".referto",   { // TODO
                        params: "<symbol>",
                        desc:   "Mark a symbol as referenced" } ],
      [ ".refto",     { alias:  ".referto" } ],

      [ ".feature",   { create: () => { return new stm.FeatureStatement() },
                        params: "<feature-name>[{-|+|off|on}][, <feature-name>[{+|-|on|off}] ...]",
                        desc:   "Enable one or more compatibility features of the assembler" } ],
      [ ".linecont",  { // TODO
                        params: "+",
                        desc:   "Enable line continuation" } ],

      [ ".localchar", { // TODO
                        // TODO: enforce single quoted single character
                        params: "<string>",
                        desc:   'Defines the character that start "cheap" local labels' } ],
      [ ".debuginfo", { // TODO
                        params: "{-|+|off|on}",
                        desc:   "Switch on or off debug info generation" } ],
      [ ".case",      { // TODO
                        params: "[{-|+|off|on}]",
                        desc:   "Switch on or off case sensitivity on identifiers" } ],

      // 65816-only
      [ ".smart",     { // TODO
                        params: "[{-|+|off|on}]",
                        desc:   "Switch on or off smart mode" } ],
      [ ".a8",        { // TODO
                        params: "",
                        desc:   "Assume the accumulator is 8 bit" } ],
      [ ".a16",       { // TODO
                        params: "",
                        desc:   "Assume the accumulator is 16 bit" } ],
      [ ".i8",        { // TODO
                        params: "",
                        desc:   "Assume the index registers are 8 bit" } ],
      [ ".i16",       { // TODO
                        params: "",
                        desc:   "Assume the index registers are 16 bit" } ],

      // *** these don't currently get parsed unless they're in the keyword position ***

      // psuedo variables
      [ ".asize",     { // TODO
                        params: "",
                        desc:   "Return the current size of the Accumulator in bits" } ],
      [ ".cpu",       { // TODO
                        params: "",
                        desc:   "Return constant integer value that tells which CPU is currently enabled" } ],
      [ ".isize",     { // TODO
                        params: "",
                        desc:   "Return the current size of the Index register in bits" } ],
      [ ".paramcount",{ // TODO
                        params: "",
                        desc:   "Return the actual number of parameters that were given in the macro invocation" } ],
      [ ".time",      { // TODO
                        params: "",
                        desc:   "Return constant integer value that represents the current time in POSIX standard" } ],
      [ ".version",   { // TODO
                        params: "",
                        desc:   "Return the assembler version" } ],
    ])

    this.functionMap = new Map<string, FunctionDef>([

      // pseudo functions
      [ ".addrsize",  { // TODO
                        params: "(<symbol>)",
                        desc:   "Internal address size associated with a symbol" } ],
      [ ".bank",      { // TODO
                        params: "(<symbol>)",
                        desc:   "Bank attribute assigned to the run memory area of the segment" } ],
      [ ".bankbyte",  { // TODO
                        params: "(<expression>)",
                        desc:   "Bank byte of argument" } ],
      [ ".blank",     { // TODO
                        params: "(<expression>)",
                        desc:  "True if the argument is blank" } ],
      [ ".concat",    { // TODO
                        params: "(<string>[, <string> ...])",
                        desc:   "Concatenate a list of string constants" } ],
      [ ".const",     { // TODO
                        params: "(<expression>)",
                        desc:   "True if the argument is a constant expression" } ],
      [ ".defined",   { create: () => { return new fnc.DefinedFunction() },
                        params: "(<symbol-weakref>)",
                        desc:  "True if symbol has already been defined somewhere up to the current position" } ],
      [ ".def",       { alias:  ".defined" } ],
      [ ".definedmacro",{ // TODO
                        params: "(<name>)",
                        desc:   "True if the identifier already has been defined as the name of a macro" } ],
      [ ".hibyte",    { // TODO
                        params: "(<expression>)",
                        desc:   "High byte of the argument" } ],
      [ ".hiword",    { // TODO
                        params: "(<expression>)",
                        desc:   "High word of the argument" } ],
      [ ".ident",     { // TODO
                        params: "(<string>)",
                        desc:   "Convert argument into an identifier" } ],
      [ ".ismnemonic",{ // TODO
                        params: "(<expression>)",
                        desc:   "True if the identifier is defined as an instruction mnemonic" } ],
      [ ".ismnem",    { alias:  ".ismnemonic" } ],
      [ ".left",      { // TODO
                        params: "(<expression>, <list>)",
                        desc:   "Extracts the left part of a given token list" } ],
      [ ".lobyte",    { // TODO
                        params: "(<expression>)",
                        desc:   "Low byte of the argument" } ],
      [ ".loword",    { // TODO
                        params: "(<expression>)",
                        desc:   "Low word of the argument" } ],
      [ ".match",     { // TODO
                        params: "(<list>, <list>)",
                        desc:   "Match two token lists against each other" } ],
      [ ".max",       { // TODO
                        params: "(<expression>, <expression>)",
                        desc:   "The larger of two values" } ],
      [ ".mid",       { // TODO
                        params: "(<expression>, <expression>, <list>)",
                        desc:   "Extract part of token list" } ],
      [ ".min",       { // TODO
                        params: "(<expression>, <expression>)",
                        desc:   "The smaller of two values" } ],
      [ ".referenced",{ // TODO
                        params: "(<symbol>)",
                        desc:   "xxx" } ],
      [ ".ref",       { alias:  ".referenced" } ],
      [ ".right",     { // TODO
                        params: "(<expression>, <list>)",
                        desc:   "Extracts the right part of a given token list" } ],
      [ ".sizeof",    { create: () => { return new fnc.SizeofFunction() },
                        params: "(<symbol-ref>)",
                        desc:  "Size of the symbol" } ],
      [ ".sprintf",   { // TODO
                        params: "(<string-exp>[, <string-exp> ...])",
                        desc:  "Formatted string" } ],
      [ ".strat",     { // TODO
                        // TODO: should be <string> eventually
                        params: "(<expression>, <index>)",
                        desc:   "Value of the character at the given position as an integer value" } ],
      [ ".string",    { // TODO
                        params: "(<expression>)",
                        desc:   "Convert argument into a string constant" } ],
      [ ".strlen",    { create: () => { return new fnc.StrlenFunction() },
                        // TODO: should be <string> eventually
                        params: "(<expression>)",
                        desc:   "Length of the string" } ],
      [ ".tcount",    { // TODO
                        params: "(<list>)",
                        desc:   "Number of tokens given as argument" } ],
      [ ".xmatch",    { // TODO
                        params: "(<list>, <list>)",
                        desc:   "Match two token lists against each other" } ],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "+",         { pre: 7, op: Op.Pos      }],  // (1) Unary positive
      [ "-",         { pre: 7, op: Op.Neg      }],  // (1) Unary negative
      [ "~",         { pre: 7, op: Op.BitNot   }],  // (1) Unary bitwise not
      [ ".BITNOT",   { pre: 7, op: Op.BitNot   }],  // (1) Unary bitwise not
      [ "<",         { pre: 7, op: Op.LowByte  }],  // (1) Unary low-byte
      [ ".LOBYTE",   { pre: 7, op: Op.LowByte  }],  // (1) Unary low-byte
      [ ">",         { pre: 7, op: Op.HighByte }],  // (1) Unary high-byte
      [ ".HIBYTE",   { pre: 7, op: Op.HighByte }],  // (1) Unary high-byte
      [ "^",         { pre: 7, op: Op.BankByte }],  // (1) Unary bank-byte
      [ ".BANKBYTE", { pre: 7, op: Op.BankByte }],  // (1) Unary bank-byte
      [ "!",         { pre: 1, op: Op.LogNot   }],  // (7) Boolean not
      [ ".NOT",      { pre: 1, op: Op.LogNot   }],  // (7) Boolean not

      [ "(",   { pre: 0,  op: Op.Group, end: ")" }]
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      // pre: 8 (0) Built-in string functions
      // pre: 7 (1) Built-in pseudo-variables
      // pre: 7 (1) Built-in pseudo-functions
      [ "*",         { pre: 6, op: Op.Mul      }],  // (2) Multiplication
      [ "/",         { pre: 6, op: Op.IDiv     }],  // (2) Division (integer)
      [ ".MOD",      { pre: 6, op: Op.Mod      }],  // (2) Modulo
      [ "&",         { pre: 6, op: Op.BitAnd   }],  // (2) Bitwise and
      [ ".BITAND",   { pre: 6, op: Op.BitAnd   }],  // (2) Bitwise and
      [ "^",         { pre: 6, op: Op.BitXor   }],  // (2) Binary bitwise xor
      [ ".BITXOR",   { pre: 6, op: Op.BitXor   }],  // (2) Binary bitwise xor
      [ "<<",        { pre: 6, op: Op.ASL      }],  // (2) Shift-left
      [ ".SHL",      { pre: 6, op: Op.ASL      }],  // (2) Shift-left
      [ ">>",        { pre: 6, op: Op.ASR      }],  // (2) Shift-right
      [ ".SHR",      { pre: 6, op: Op.ASR      }],  // (2) Shift-right
      [ "+",         { pre: 5, op: Op.Add      }],  // (3) Binary addition
      [ "-",         { pre: 5, op: Op.Sub      }],  // (3) Binary subtraction
      [ "|",         { pre: 5, op: Op.BitOr    }],  // (3) Bitwise or
      [ ".BITOR",    { pre: 5, op: Op.BitOr    }],  // (3) Bitwise or
      [ "=",         { pre: 4, op: Op.EQ       }],  // (4) Compare equal
      [ "<>",        { pre: 4, op: Op.NE       }],  // (4) Compare not equal
      [ "<",         { pre: 4, op: Op.LT       }],  // (4) Compare less
      [ ">",         { pre: 4, op: Op.GT       }],  // (4) Compare greater
      [ "<=",        { pre: 4, op: Op.LE       }],  // (4) Compare less or equal
      [ ">=",        { pre: 4, op: Op.GE       }],  // (4) Compare greater or equal
      [ "&&",        { pre: 3, op: Op.LogAnd   }],  // (5) Boolean and
      [ ".AND",      { pre: 3, op: Op.LogAnd   }],  // (5) Boolean and
      [ ".XOR",      { pre: 3, op: Op.LogXor   }],  // (5) Boolean xor
      [ "||",        { pre: 2, op: Op.LogOr    }],  // (6) Boolean or
      [ ".OR",       { pre: 2, op: Op.LogOr    }],  // (6) Boolean or
    ])

    // TODO: is ">>" ASR or LSR?
  }
}

//------------------------------------------------------------------------------
