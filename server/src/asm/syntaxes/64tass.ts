
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// 64TASS
//------------------------------------------------------------------------------
//  Precedence:
//    operobj.c
//------------------------------------------------------------------------------

export class Tass64Syntax extends SyntaxDef {

  public symbolTokenPrefixes = "._#\\"
  public symbolTokenContents = ""     // TODO: "." within symbol?
  public cheapLocalPrefixes = "_"
  public zoneLocalPrefixes = ""
  public keywordsInColumn1 = true
  public macroDefineWithLabel = true   // <name> .macro [<params>]
  public macroDefineParams = true
  public macroInvokePrefixes = "#"
  public macroInvokeDelimiters = ","

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      // target
      [ ".cpu",     { create: () => { return new stm.CpuStatement() },
                      params: '{"6502"|"65c02"|"65816"|"default"}',
                      desc:   "Selects CPU according to the string argument"}],

      // equates
      [ "=",        { create: () => { return new stm.EquStatement() }}],
      [ ":=",       { create: () => { return new stm.EquStatement() }}],
      [ ":?=",      { create: () => { return new stm.EquStatement() }}],

      // pc
      [ "*",        { create: () => { return new stm.OrgStatement() },
                      desc:   "Current program counter value"}],
      // .logical <expression>
      // .endlogical
      // [ ".here",    { alias: ".endlogical" }],
      // .virtual [<expression>]
      // .endvirtual
      // [ ".endv",    { alias: ".endvirtual" }],

      // disk
      [ ".include", { create: () => { return new stm.IncludeStatement() },
                      params: "<filename>",
                      desc:   "Include source file"}],
      [ ".binary",  { create: () => { return new stm.IncBinStatement() },
                      params: "<filename>[, <offset>[, <length>]]",
                      desc:   "Include raw binary data from file"}],

      // macros
      [ ".macro",   { create: () => { return new stm.MacroDefStatement() },
                      params: "[<name>][=<default>]][, [<name>][=<default>] ...]",
                      desc:   "Start of macro block"}],
      [ ".endmacro",{ create: () => { return new stm.EndMacroDefStatement() },
                      params: "[<result>][, <result> ...]",
                      desc:   "End of macro block"}],
      [ ".endm",    { alias: ".endmacro" }],

      // data storage
      [ ".byte",    { create: () => { return new stm.DataStatement_U8() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 8 bit unsigned constants (0–255)"}],
      [ ".char",    { create: () => { return new stm.DataStatement_S8() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 8 bit signed constants (−128–127)"}],
      [ ".word",    { create: () => { return new stm.DataStatement_U16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 16 bit unsigned constants (0–65535)"}],
      [ ".sint",    { create: () => { return new stm.DataStatement_S16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create bytes from 16 bit signed constants (−32768–32767)"}],
      [ ".addr",    { create: () => { return new stm.DataStatement_U16() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Create 16 bit address constants for addresses"}],
      // .rta <expression>[, <expression>, …]
      // .long <expression>[, <expression>, …]
      // .lint <expression>[, <expression>, …]
      // .dword <expression>[, <expression>, …]
      // .dint <expression>[, <expression>, …]
      // .text bits(<expression>[, <bit count>])
      // .text bytes(<expression>[, <byte count>])

      // text
      [ ".fill",    { create: () => { return new stm.StorageStatement(1) },
                      params: "<length>[, <fill>]",
                      desc:   "Reserve space or fill with repeated bytes"}],
      [ ".text",    { create: () => { return new stm.TextStatement() },
                      params: "<expression>[, <expression> ...]",
                      desc:   "Assemble strings into 8 bit bytes"}],
      // .null <expression>[, <expression>, …]
      // .ptext <expression>[, <expression>, …]
      // .shift <expression>[, <expression>, …]
      // .shiftl <expression>[, <expression>, …]

      // .enc <expression>
      [ ".enc",     {
                      params: "<expression>",
                      desc:   "Selects text encoding by a character string name or from an encoding object" }],
      // .encode [<expression>]
      // .endencode
      // .cdef <start>, <end>, <coded> [, <start>, <end>, <coded>, …]
      // .cdef "<start><end>", <coded> [, "<start><end>", <coded>, …]
      // .tdef <expression>, <expression> [, <expression>, <expression>, …]
      // .edef "<escapetext>", <value> [, "<escapetext>", <value>, …]

      // .page [<interval>[, <offset>]]
      // .endpage
      // .endp
      // [ ".align",   { create: () => { return new stm.AlignStatement() },
      //                 params: "[<interval>[, <fill>[, <offset>]]]",
      //                 desc:   "Align the program counter to a page boundary"}],
      // .alignblk [<interval>[, <fill>[, <offset>]]]
      // .endalignblk
      // .alignpageind <target>[, <interval>[, <fill>[, <offset>]]]
      // .alignind <target>[, <interval>[, <fill>[, <offset>]]]

      // C-types
      // [ ".union",     { create: () => { return new stm.UnionStatement() }}],
      // [ ".endunion",  { create: () => { return new stm.EndUnionStatement() }}],
      // [ ".endu",      { alias: ".endunion" }],

      // [ ".enum",      { create: () => { return new stm.EnumStatement() }}],
      // [ ".endenum",   { create: () => { return new stm.EndEnumStatement() }}],
      // [ ".struct",    { create: () => { return new stm.StructStatement() }}],
      // [ ".endstruct", { create: () => { return new stm.EndStructStatement() }}],

      // conditionals
      [ ".if",        { create: () => { return new stm.IfStatement() },
                        params: "<condition>",
                        desc:   "Compile if condition is true"}],
      [ ".ifne",      { create: () => { return new stm.IfStatement(Op.NE) },
                        params: "<value>",
                        desc:   "Compile if value is not zero"}],
      [ ".ifeq",      { create: () => { return new stm.IfStatement(Op.EQ) },
                        params: "<value>",
                        desc:   "Compile if value is zero"}],
      [ ".ifpl",      { create: () => { return new stm.IfStatement(Op.PL) },
                        params: "<value>",
                        desc:   "Compile if value is greater or equal zero"}],
      [ ".ifmi",      { create: () => { return new stm.IfStatement(Op.MI) },
                        params: "<value>",
                        desc:   "Compile if value is less than zero"}],
      [ ".else",      { create: () => { return new stm.ElseStatement() },
                        params: "",
                        desc:   "Compile if previous conditions were not met"}],
      [ ".elsif",     { create: () => { return new stm.ElseIfStatement() },
                        params: "<condition>",
                        desc:   "Compile if previous conditions were not met and the condition is true"}],
      [ ".endif",     { create: () => { return new stm.EndIfStatement() },
                        params: "",
                        desc:   "End of conditional compilation"}],
      [ ".fi",        { alias: ".endif" }],
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
