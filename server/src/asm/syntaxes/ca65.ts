
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// CA65
//------------------------------------------------------------------------------
//  Precedence:
//    https://cc65.github.io/doc/ca65.html#ss5.5
//
//    NOTE: precedence reversed from 0->7 to 8->1
//------------------------------------------------------------------------------

export class Ca65Syntax extends SyntaxDef {

  public symbolTokenPrefixes = ".@"
  public symbolTokenContents = ""
  public cheapLocalPrefixes = "@"
  public zoneLocalPrefixes = ""
  public keywordsInColumn1 = true
  public macroDefineWithLabel = false  // mac <name> [<params>]
  public macroDefineParams = true
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ","

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ ".assert",    { create: () => { return new stm.AssertStatement() }}],

      // equates
      [ "=",          { create: () => { return new stm.EquStatement() }}],
      [ ":=",         { create: () => { return new stm.EquStatement() }}],
      [ ".set",       { create: () => { return new stm.VarAssignStatement() }}],

      // pc
      [ ".org",       { create: () => { return new stm.OrgStatement() }}],

      // disk
      [ ".include",   { create: () => { return new stm.IncludeStatement() }}],
      [ ".incbin",    { create: () => { return new stm.IncBinStatement() }}],

      // macros
      [ ".macro",     { create: () => { return new stm.MacroDefStatement() }}],
      [ ".mac",       { alias: ".macro" }],
      [ ".endmacro",  { create: () => { return new stm.EndMacroDefStatement() }}],
      [ ".endmac",    { alias: ".endmacro" }],

      // data storage
      [ ".byte",      { create: () => { return new stm.DataStatement_U8() }}],
      [ ".dbyt",      { create: () => { return new stm.DataStatement_U16(true) }}],
      [ ".word",      { create: () => { return new stm.DataStatement_U16() }}],
      [ ".addr",      { create: () => { return new stm.DataStatement_U16() }}],
      [ ".faraddr",   { create: () => { return new stm.DataStatement_U24() }}],
      [ ".dword",     { create: () => { return new stm.DataStatement_U32() }}],
      [ ".res",       { create: () => { return new stm.StorageStatement(1) }}],
      [ ".tag",       { create: () => { return new stm.StorageStatement(-1) }}],
      [ ".align",     { create: () => { return new stm.AlignStatement() }}],

      // conditionals
      [ ".if",        { create: () => { return new stm.IfStatement() }}],
      [ ".ifdef",     { create: () => { return new stm.IfDefStatement(true) }}],
      [ ".ifndef",    { create: () => { return new stm.IfDefStatement(false) }}],
      [ ".else",      { create: () => { return new stm.ElseStatement() }}],
      [ ".elseif",    { create: () => { return new stm.ElseIfStatement() }}],
      [ ".endif",     { create: () => { return new stm.EndIfStatement() }}],
      [ ".end",       {}],

      // looping
      [ ".repeat",    { create: () => { return new stm.RepeatStatement() }}],
      [ ".endrep",    { create: () => { return new stm.EndRepStatement() }}],
      [ ".endrepeat", { create: () => { return new stm.EndRepStatement() }}],

      // import/export
      [ ".import",    { create: () => { return new stm.ImportExportStatement(false, false) }}],
      [ ".importzp",  { create: () => { return new stm.ImportExportStatement(false, true) }}],
      [ ".export",    { create: () => { return new stm.ImportExportStatement(true, false) }}],
      [ ".exportzp",  { create: () => { return new stm.ImportExportStatement(true, true) }}],

      // segments
      [ ".segment",   { create: () => { return new stm.SegmentStatement() }}],
      [ ".code",      { create: () => { return new stm.SegmentStatement("CODE") }}],
      [ ".data",      { create: () => { return new stm.SegmentStatement("DATA") }}],
      [ ".bss",       { create: () => { return new stm.SegmentStatement("BSS") }}],
      [ ".rodata",    { create: () => { return new stm.SegmentStatement("RODATA") }}],

      // C-types
      [ ".enum",      { create: () => { return new stm.EnumStatement() }}],
      [ ".endenum",   { create: () => { return new stm.EndEnumStatement() }}],
      [ ".struct",    { create: () => { return new stm.StructStatement() }}],
      [ ".endstruct", { create: () => { return new stm.EndStructStatement() }}],
      [ ".union",     { create: () => { return new stm.UnionStatement() }}],
      [ ".endunion",  { create: () => { return new stm.EndUnionStatement() }}],

      // scope
      [ ".scope",     { create: () => { return new stm.ScopeStatement() }}],
      [ ".endscope",  { create: () => { return new stm.EndScopeStatement() }}],
      [ ".proc",      { create: () => { return new stm.ProcStatement() }}],
      [ ".endproc",   { create: () => { return new stm.EndProcStatement() }}],

      [ ".define",    {}],
      [ ".local",     {}],
      [ ".zeropage",  {}],
      [ ".hibytes",   {}],
      [ ".lobytes",   {}],
      [ ".fatal",     {}],
      [ ".error",     {}],
      [ ".warning",   {}],
      [ ".out",       {}],
      [ ".defined",   {}],    // ()
      [ ".sizeof",    {}],    // ()
      [ ".blank",     {}],    // ()
      [ ".sprintf",   {}],    // ()
      [ ".macpack",   {}],
      [ ".cpu",       {}],
      [ ".feature",   { create: () => { return new stm.FeatureStatement() }}],
      [ ".linecont",  {}]     // + (enable line continuation)
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
