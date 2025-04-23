
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// 64TASS
//------------------------------------------------------------------------------
//  Precedence:
//    operobj.c
//------------------------------------------------------------------------------

export class Tass64Syntax extends SyntaxDef {

  public caseSensitiveSymbols = false        // TODO: check this
  public symbolTokenPrefixes = "._\\"
  public symbolTokenContents = ""     // TODO: "." within symbol? In conjuctions w/scope?
  public cheapLocalPrefixes = "_"
  public zoneLocalPrefixes = ""
  public anonLocalChars = "+-"
  public namedParamPrefixes = "\\"
  public keywordPrefixes = "."
  public keywordsInColumn1 = true
  public macroInvokePrefixes = "#."
  public macroInvokeDelimiters = ","
  public allowLabelTrailingColon = true
  public allowIndentedAssignment = true
  public allowLineContinuation = false
  public stringEscapeChars = ""
  public scopeSeparator = "."
  public defaultOrg = 0x0800        // TODO: choose correct value

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      // target, see https://tass64.sourceforge.net/#target-cpu
      [ ".cpu",     { create: () => { return new stm.CpuStatement() },
                      params: '{"6502"|"65c02"|"65ce02"|"6502i"|"65816"|"65dtv02"|"65el02"|"r65c02"|"w65c02"|"4510"|"default"}',
                      desc:   "Selects CPU according to the string argument" } ],

      // equates
      [ "=",        { create: () => { return new stm.EquStatement() },
                      label:  "<symbol>",
                      params: "<expression>",
                      desc:   "Assign a constant value" } ],
      [ ":=",       { create: () => { return new stm.EquStatement() },
                      label:  "<symbol>",
                      params: "<expression>",
                      desc:   "Assign a variable value" } ],
      [ "::=",      { create: () => { return new stm.EquStatement() },
                      label:  "<symbol>",
                      params: "<expression>",
                      desc:   "Reassign a variable value" } ],
      [ ":?=",      { create: () => { return new stm.EquStatement() },
                      label:  "<symbol>",
                      params: "<expression>",
                      desc:   "Conditionally assign a value" } ],

      // pc
      [ "*",        { create: () => { return new stm.OrgStatement() },
                      params: "= <expression>",
                      desc:   "Current program counter value" } ],
      [ ".logical", { // TODO
                      params: "<expression>",
                      desc:   "Starts a relocation block" } ],
      [ ".endlogical", { // TODO
                      params: "",
                      desc:   "Ends a relocation block" } ],
      [ ".here",    { alias: ".endlogical" } ],
      [ ".virtual", { // TODO
                      params: "[<expression>]",
                      desc:   "Starts a virtual block" } ],
      [ ".endvirtual", { // TODO
                      params: "",
                      desc:   "Ends a virtual block" } ],
      [ ".endv",    { alias: ".endvirtual" } ],
      [ ".offs",    { // TODO
                      params: "<expression>",
                      desc:   "Sets the compile offset relative to the program counter" } ],

      // disk
      [ ".include", { create: () => { return new stm.IncludeStatement() },
                      params: "<filename>",
                      desc:   "Include source file" } ],
      [ ".binclude",{ // TODO
                      params: "<filename>",
                      desc:   "Include source file here in it's local block" } ],
      [ ".binary",  { create: () => { return new stm.IncBinStatement() },
                      params: "<filename>[, <offset>[, <length>]]",
                      desc:   "Include raw binary data from file" } ],

      // macros
      [ ".macro",   { create: () => { return new stm.MacroDefStatement() },
                      label:  "<symbol>",
// *** maybe change type-param to make it easier to detect defaults? ***
                      params: "[ [<type-param>[=<default>]][, [<type-param>[=<default>]] ...] ]",
                      desc:   "Start of macro block" } ],
      [ ".endmacro",{ create: () => { return new stm.EndMacroDefStatement() },
                      params: "[<result>][, <result> ...]",
                      desc:   "End of macro block" } ],
      [ ".endm",    { alias: ".endmacro" } ],
      [ ".segment", { create: () => { return new stm.MacroDefStatement() },
                      label:  "<symbol>",
                      params: "[ [<name>[=<default>]][, [<name>[=<default>]] ...] ]",
                      desc:   "Start of segment block" } ],
      [ ".endsegment",{ create: () => { return new stm.EndMacroDefStatement() },
                      params: "[<result>][, <result> ...]",
                      desc:   "End of segment block" } ],

      [ ".sfunction",{ // TODO
                      label:  "<symbol>",
                      // TODO: needs work
                      // params: "[<name>[:<expression>][=<default>], ...][*<name>,] <expression>",
                      params: "[<name>[:<expression>][=<default>], ...] <expression>",
                      desc:   "Defines a simple function to return the result of a parametrised expression" } ],
      [ ".function",{ // TODO
                      label:  "<symbol>",
                      // TODO: needs work
                      // params: "<name>[:<expression>][=<default>], <name>[=<default>] ...][, *<name>]",
                      params: "[<name>[:<expression>][=<default>], <name>[=<default>] ...]",
                      desc:   "Defines a multi line function" } ],
      [ ".endfunction",{ // TODO
                      params: "[<result>][, <result> ...]",
                      desc:   "End of a multi line function" } ],
      [ ".endf",    { alias: ".endfunction" } ],

      // data storage
      [ ".byte",    { create: () => { return new stm.DataStatement_U8() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 8 bit unsigned constants (0-255)" } ],
      [ ".char",    { create: () => { return new stm.DataStatement_S8() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 8 bit signed constants (-128-127)" } ],
      [ ".word",    { create: () => { return new stm.DataStatement_U16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 16 bit unsigned constants (0-65535)" } ],
      [ ".sint",    { create: () => { return new stm.DataStatement_S16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 16 bit signed constants (-32768-32767)" } ],
      [ ".addr",    { create: () => { return new stm.DataStatement_U16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create 16 bit address constants for addresses" } ],
      [ ".rta",     { create: () => { return new stm.DataStatement_U16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create 16 bit return address constants for addresses" } ],
      [ ".long",    { create: () => { return new stm.DataStatement_U24() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 24 bit unsigned constants (0-16777215)" } ],
      [ ".lint",    { create: () => { return new stm.DataStatement_S24() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 24 bit signed constants (-8388608-8388607)" } ],
      [ ".dword",   { create: () => { return new stm.DataStatement_U32() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 32 bit unsigned constants (0-4294967295)" } ],
      [ ".dint",    { create: () => { return new stm.DataStatement_S32() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 32 bit signed constants (-2147483648-2147483647)" } ],

      // text
      [ ".text",    { create: () => { return new stm.TextStatement() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Assemble strings into 8 bit bytes" } ],
      [ ".fill",    { create: () => { return new stm.StorageStatement(1) },
                      params: "<count>[, <fill>]",
                      desc:   "Reserve space or fill with repeated bytes" } ],
      [ ".shift",   { // TODO
                      params: "<expression>[, <expression> ...]",
                      desc:   "Assemble strings of 7 bit bytes and mark the last byte by setting it's most significant bit" } ],
      [ ".shiftl",  { // TODO
                      params: "<expression>[, <expression> ...]",
                      desc:   "Assemble strings of 7 bit bytes shifted to the left once with the last byte's least significant bit set" } ],
      [ ".null",    { // TODO
                      params: "<expression>[, <expression> ...]",
                      desc:   "Assemble strings into 8 bit bytes and add a zero byte to the end" } ],
      [ ".ptext",   { // TODO
                      params: "<expression>[, <expression> ...]",
                      desc:   "Assemble strings into 8 bit bytes and prepend the number of bytes in front of the string (pascal style string)" } ],

      [ ".enc",     { // TODO
                      params: '{ "screen" | "none" | <string> }',
                      desc:   "Selects text encoding by a character string name or from an encoding object" } ],
      [ ".encode",  { // TODO
                      params: "[<expression>]",
                      desc:   "Encoding area start" } ],
      [ ".endencode", { // TODO
                      params: "",
                      desc:   "Encoding area end" } ],
      [ ".cdef",    { // TODO
                      // TODO: needs work
                      params: '{<start>, <end>, <coded> [, <start>, <end>, <coded> ...]|<start-end:string>, <coded> [, "<start-end:string>", <coded> ...]}',
                      desc:   "Assigns characters in a range to single byte" } ],
      [ ".tdef",    { // TODO
                      params: '<expression>, <expression> [, <expression>, <expression> ...]',
                      desc:   "Assign single characters to byte values" } ],
      [ ".edef",    { // TODO
                      params: '<escapetext:string>, <value> [, <escapetext:string>, <value>, ...]',
                      desc:   "Assigns strings to byte sequences as a translated value" } ],

      // alignmet
      [ ".page",      { // TODO
                        params: "[<interval>[, <offset>]]",
                        desc:   "Start of page check block" } ],
      [ ".endpage",   { // TODO
                        params: "",
                        desc:   "End of page check block" } ],
      [ ".endp",      { alias: ".endpage" } ],
      [ ".align",     { create: () => { return new stm.AlignStatement() },
                                // *** generalize question mark as expression ***
                        params: "[<boundary>[, {?|<fill>}[, <offset>]]]",
                        desc:   "Align the program counter to a page boundary" } ],
      [ ".alignblk",  { // TODO
                        params: "[<interval>[, <fill>[, <offset>]]]",
                        desc:   "Start alignment block" } ],
      [ ".endalignblk",{ // TODO
                        params: "",
                        desc:   "Ends alignment block" } ],
      [ ".alignpageind",{ // TODO
                        params: "<target>[, <interval>[, <fill>[, <offset>]]]",
                        desc:   "Alignment of a page block indirectly" } ],
      [ ".alignind",  { // TODO
                        params: "<target>[, <interval>[, <fill>[, <offset>]]]",
                        desc:   "Align the target location to a page boundary indirectly" } ],

      // structured data
      [ ".struct",    { create: () => { return new stm.StructStatement() },
                        params: "[[<type-param>][=<default>][, [<type-param>][=<default>] ...]]",
                        desc:   "Begin a structure block" } ],
      [ ".endstruct", { create: () => { return new stm.EndStructStatement() },
                        params: "",
                        desc:   "End a structure block" } ],
      [ ".ends",      { alias: ".endstruct" } ],
      [ ".dstruct",   { // TODO
                        params: "<struct-name>[, <value> ...]",
                        desc:   "Create instance of structure with initialization values" } ],
      [ ".union",     { create: () => { return new stm.UnionStatement() },
                        params: "[[<type-param>][=<default>][, [<type-param>][=<default>] ...]]",
                        desc:   "Begin a union block" } ],
      [ ".endunion",  { create: () => { return new stm.EndUnionStatement() },
                        params: "",
                        desc:   "End a union block" } ],
      [ ".endu",      { alias: ".endunion" } ],
      [ ".dunion",    { // TODO
                        params: "<union-name>[, <value> ...]",
                        desc:   "Create instance of union with initialization values" } ],

      // conditionals
      [ ".if",        { create: () => { return new stm.IfStatement() },
                        params: "<condition>",
                        desc:   "Compile if condition is true" } ],
      [ ".ifne",      { create: () => { return new stm.IfStatement(Op.NE) },
                        params: "<value>",
                        desc:   "Compile if value is not zero" } ],
      [ ".ifeq",      { create: () => { return new stm.IfStatement(Op.EQ) },
                        params: "<value>",
                        desc:   "Compile if value is zero" } ],
      [ ".ifpl",      { create: () => { return new stm.IfStatement(Op.PL) },
                        params: "<value>",
                        desc:   "Compile if value is greater or equal zero" } ],
      [ ".ifmi",      { create: () => { return new stm.IfStatement(Op.MI) },
                        params: "<value>",
                        desc:   "Compile if value is less than zero" } ],
      [ ".else",      { create: () => { return new stm.ElseStatement() },
                        params: "",
                        desc:   "Compile if previous conditions were not met" } ],
      [ ".elsif",     { create: () => { return new stm.ElseIfStatement() },
                        params: "<condition>",
                        desc:   "Compile if previous conditions were not met and the condition is true" } ],
      [ ".endif",     { create: () => { return new stm.EndIfStatement() },
                        params: "",
                        desc:   "End of conditional compilation" } ],
      [ ".fi",        { alias: ".endif" } ],

      [ ".end",     { // TODO
                      params: "",
                      desc:   "Terminate assembly" } ],

      [ ".for",     { // TODO
                      params: "[<assignment>], [<condition>], [<assignment>]",
                      desc:   "Assign initial value, loop while the condition is true and modify value" } ],
      [ ".bfor",    { // TODO
                      params: "[<assignment>], [<condition>], [<assignment>]",
                      desc:   "Assign initial value, loop while the condition is true and modify value" } ],
      [ ".endfor",  { // TODO
                      params: "",
                      desc:   "End of a .for or .bfor loop block" } ],
      [ ".rept",    { // TODO
                      params: "<loop-count>",
                      desc:   "Repeat enclosed lines the specified number of times" } ],
      [ ".brept",   { // TODO
                      params: "<loop-count>",
                      desc:   "Repeat enclosed lines the specified number of times" } ],
      [ ".endrept", { // TODO
                      params: "",
                      desc:   "End of a .rept or .brept block" } ],

      [ ".while",   { // TODO
                      params: "<condition>",
                      desc:   "Repeat enclosed lines until the condition holds" } ],
      [ ".bwhile",  { // TODO
                      params: "<condition>",
                      desc:   "Repeat enclosed lines until the condition holds" } ],
      [ ".endwhile",{ // TODO
                      params: "",
                      desc:   "End of a .while or .bwhile loop block" } ],
      [ ".next",    { // TODO
                      params: "",
                      desc:   "End of .for, .bfor, .rept, .brept, .while and .bwhile loop for compatibility" } ],

      [ ".break",   { // TODO
                      params: "",
                      desc:   "Exit current repetition loop immediately" } ],
      [ ".breakif", { // TODO
                      params: "<condition>",
                      desc:   "Exit current repetition loop immediately if the condition holds" } ],

      [ ".continue",{ // TODO
                      params: "",
                      desc:   "Continue current repetition loop's next iteration" } ],
      [ ".continueif",{ // TODO
                      params: "<condition>",
                      desc:   "Continue current repetition loop's next iteration if the condition holds" } ],

      [ ".lbl",     { // TODO
                      label:  "<symbol>",
                      params: "",
                      desc:   "Creates a special jump label that can be referenced by .goto" } ],
      [ ".goto",    { // TODO
                      params: "<labelname>",
                      desc:   "Causes assembler to continue assembling from the jump label" } ],
      [ ".switch",  { // TODO
                      params: "<expression>",
                      desc:   "Evaluate expression and remember it" } ],
      [ ".case",    { // TODO
                      params: "<expression>[, <expression> ...]",
                      desc:   "Compile if the previous conditions were all skipped and one of the values equals" } ],
      [ ".default", { // TODO
                      params: "",
                      desc:   "Compile if the previous conditions were all skipped" } ],
      [ ".endswitch",{ // TODO
                      params: "",
                      desc:   "End of .switch conditional compilation block" } ],

      [ ".proc",    { // TODO
                      label:  "<symbol>",
                      params: "",
                      desc:   "Start of a procedure block" } ],
      [ ".endproc", { // TODO
                      params: "",
                      desc:   "End of a procedure block" } ],
      [ ".pend",    { alias: ".endproc" } ],

      [ ".block",   { // TODO
                      params: "",
                      desc:   "Block scoping area start" } ],
      [ ".endblock",{ // TODO
                      params: "",
                      desc:   "Block scoping area end" } ],
      [ ".bend",    { alias: ".endblock" } ],

      [ ".namespace",{ // TODO
                      params: "[<expression>]",
                      desc:   "Namespace area start" } ],
      [ ".endnamespace",{ // TODO
                      params: "",
                      desc:   "Namespace area end" } ],
      [ ".endn",    { alias: ".endnamespace" } ],

      [ ".weak",    { // TODO
                      params: "",
                      desc:   "Begin weak symbol area" } ],
      [ ".endweak", { // TODO
                      params: "",
                      desc:   "End weak symbol area" } ],

      [ ".with",    { // TODO
                      params: "<expression>",
                      desc:   "Begin namespace access" } ],
      [ ".endwith", { // TODO
                      params: "",
                      desc:   "End namespace access" } ],

      [ ".section", { // TODO
                      params: "<name>",
                      desc:   "Starts a segment block" } ],
      [ ".endsection",{ // TODO
                      params: "[<name>]",
                      desc:   "Ends a segment block" } ],
      [ ".send",    { alias: ".endsection" } ],

      [ ".dsection",{ // TODO
                      params: "<symbol>",
                      desc:   "Collect the section fragments here" } ],

      [ ".option",  { // TODO
                      // *** check this ***
                      params: "allow_branch_across_page = {0|1}",
                      desc:   "Switches error generation on page boundary crossing during relative branch" } ],

      [ ".error",   { create: () => { return new stm.AssertTrueStatement("error", true) },
                      params: "<message> [, <message> ...]",
                      desc:   "Exit with error" } ],
      [ ".cerror",  { create: () => { return new stm.AssertFalseStatement("error") },
                      params: "<condition>, <message> [, <message> ...]",
                      desc:   "Conditionally exit with error" } ],

      [ ".warn",    { create: () => { return new stm.AssertTrueStatement("warning", true) },
                      params: "<message> [, <message> ...]",
                      desc:   "Display a warning message" } ],
      [ ".cwarn",   { create: () => { return new stm.AssertFalseStatement("warning") },
                      params: "<condition>, <message> [, <message> ...]",
                      desc:   "Display a warning message depending on a condition" } ],

      [ ".eor",     { // TODO
                      params: "<expression>",
                      desc:   "XOR output with an 8 bit value" } ],
      [ ".seed",    { // TODO
                      params: "<expression>",
                      desc:   "Seed the pseudo random number generator with an unsigned integer of maximum 128 bits" } ],
      [ ".var",     { // TODO
                      // *** label required
                      params: "<expression>",
                      desc:   "Defines a variable identified by the label preceding" } ],
      [ ".from",    { // TODO
                      params: "<scope>",
                      desc:   "Defines a symbol to the value of the same symbol from another scope" } ],

      [ ".pron",    { // TODO
                      params: "",
                      desc:   "Turn on source listing on part of the file" } ],
      [ ".proff",   { // TODO
                      params: "",
                      desc:   "Turn off source listing on part of the file" } ],

      [ ".comment", { // TODO
                      params: "",
                      desc:   "Never compile" } ],
      [ ".endcomment",{ // TODO
                      params: "",
                      desc:   "End of .comment block" } ],
      [ ".endc",    { alias: ".endcomment" } ],

      // 65816-only
      [ ".al",        { // TODO
                        params: "",
                        desc:   "Select long (16-bit) accumulator immediate constants" } ],
      [ ".as",        { // TODO
                        params: "",
                        desc:   "Select short (8-bit) accumulator immediate constants" } ],
      [ ".xl",        { // TODO
                        params: "",
                        desc:   "Select long (16-bit) index register immediate constants" } ],
      [ ".xs",        { // TODO
                        params: "",
                        desc:   "Select short (8-bit) index register immediate constants" } ],
      [ ".autsiz",    { // TODO
                        params: "",
                        desc:   "Select automatic adjustment of immediate constant sizes based on SEP/REP instructions" } ],
      [ ".mansiz",    { // TODO
                        params: "",
                        desc:   "Select manual adjustment of immediate constant sizes based on SEP/REP instructions" } ],
      [ ".databank",  { // TODO
                        params: "<expression>",
                        desc:   "Data bank (absolute) addressing is only used for addresses falling into this 64 KiB bank" } ],
      [ ".dpage",     { // TODO
                        params: "<expression>",
                        desc:   "Direct (zero) page addressing is only used for addresses falling into a specific 256 byte address range" } ],
    ])

    this.unaryOpMap = new Map<string, OpDef>([

      // "member '.", O_MEMBER, 22
      // "register indexing ',y", O_COMMAY, 21
      // "register indexing ',x", O_COMMAX, 21
      // "repeat 'x", O_X, 20
      // "concatenate '..", O_CONCAT, 19
      // "unary splat '*", O_SPLAT, 18
      [ "!",         { pre: 17, op: Op.LogNot   }],
      [ "~",         { pre: 17, op: Op.BitNot   }],
      [ "+",         { pre: 17, op: Op.Pos      }],
      [ "-",         { pre: 17, op: Op.Neg      }],

      [ "^",         { pre: 4, op: Op.BankByte }],
      [ ">",         { pre: 4, op: Op.HighByte }],
      [ "<",         { pre: 4, op: Op.LowByte  }],
      // "swapped word '><", O_BSWORD, 4
      // "high word '>`", O_HWORD, 4
      // "word '<>", O_WORD, 4

      [ "(",         { pre: 0,  op: Op.Group, end: ")" }],
      [ "[",         { pre: 0,  op: Op.Group, end: "]" }],
      [ "{",         { pre: 0,  op: Op.Group, end: "}" }],
      // "'}", O_RBRACE, 0
      // "']", O_RBRACKET, 0
      // "')", O_RPARENT, 0
    ])

    this.binaryOpMap = new Map<string, OpDef>([

      // "exponent '**", O_EXP, 16
      [ "%",         { pre: 15, op: Op.Mod   }],
      [ "/",         { pre: 15, op: Op.IDiv  }],
      [ "*",         { pre: 15, op: Op.Mul   }],
      [ "-",         { pre: 14, op: Op.Sub   }],
      [ "+",         { pre: 14, op: Op.Add   }],
      [ ">>",        { pre: 13, op: Op.ASR   }],
      [ "<<",        { pre: 13, op: Op.ASL   }],
      [ "&",         { pre: 12, op: Op.BitAnd }],
      [ "^",         { pre: 11, op: Op.BitXor }],
      [ "|",         { pre: 10, op: Op.BitOr  }],
      // "greater of '>?", O_MAX, 9
      // "smaller of '<?", O_MIN, 9
      [ "<=",        { pre: 8, op: Op.LE    }],
      [ ">=",        { pre: 8, op: Op.GE    }],
      [ ">",         { pre: 8, op: Op.GT    }],
      [ "<",         { pre: 8, op: Op.LT    }],
      [ "!=",        { pre: 8, op: Op.NE    }],
      [ "==",        { pre: 8, op: Op.EQ    }],
      // "compare '<=>", O_CMP, 8
      // "excludes '!in", O_NOTIN, 8
      // "contains 'in", O_IN, 8
      // "not identical '!==", O_NIDENTITY, 8
      // "identical '===", O_IDENTITY, 8
      [ "&&",        { pre: 7, op: Op.LogAnd }],
      // "logical xor '^^", O_LXOR, 6
      [ "||",        { pre: 5, op: Op.LogOr  }],
      // "decimal string '^", O_STRING, 4

      // "signed immediate '#+", O_HASH_SIGNED, 3
      // "immediate '#", O_HASH, 3
      // "':", O_COLON2, 3
      // "condition '??", O_DCOND, 3
      // "condition '?", O_COND, 3
      // "':", O_COLON, 2
      // "'??", O_DQUEST, 2
      // "'?", O_QUEST, 2
      // "conditional assign ':?=", O_COND_ASSIGN, 2
      // "logical and assign '&&=", O_LAND_ASSIGN, 2
      // "logical or assign '||=", O_LOR_ASSIGN, 2
      // "member assign '.=", O_MEMBER_ASSIGN, 2
      // "repeat assign 'x=", O_X_ASSIGN, 2
      // "concatenate assign '..=", O_CONCAT_ASSIGN, 2
      // "exponent assign '**=", O_EXP_ASSIGN, 2
      // "modulo assign '%=", O_MOD_ASSIGN, 2
      // "division assign '/=", O_DIV_ASSIGN, 2
      // "multiply assign '*=", O_MUL_ASSIGN, 2
      // "subtract assign '-=", O_SUB_ASSIGN, 2
      // "add assign '+=", O_ADD_ASSIGN, 2
      // "binary right shift assign '>>=", O_BRS_ASSIGN, 2
      // "binary left shift assign '<<=", O_BLS_ASSIGN, 2
      // "binary and assign '&=", O_AND_ASSIGN, 2
      // "binary exclusive or assign '^=", O_XOR_ASSIGN, 2
      // "binary or assign '|=", O_OR_ASSIGN, 2
      // "greater of assign '>?=", O_MAX_ASSIGN, 2
      // "smaller of assign '<?=", O_MIN_ASSIGN, 2
      // "variable reassign '::=", O_REASSIGN, 2
      // "variable assign ':=", O_COLON_ASSIGN, 2
      // "assign '=", O_ASSIGN, 2
      // "',", O_COMMA, 1

      // "indexing '[]", O_INDEX, 0
      // "function call '()", O_FUNC, 0
      // "'}", O_DICT, 0
      // "']", O_LIST, 0
      // "')", O_TUPLE, 0
    ])
  }
}

//------------------------------------------------------------------------------
