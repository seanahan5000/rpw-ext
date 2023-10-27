
import * as stm from "./statements"

// *** keywords should be a translation step -- no statement creation
// *** attempt resolve with multiple precedence defs as see if values match

//------------------------------------------------------------------------------

export enum Op {

  Unused = 0,

  // unary
  Neg,
  Pos,
  LogNot,
  BitNot,
  LowByte,
  HighByte,
  BankByte,

  // binary
  Pow,
  Mul,
  FDiv,
  IDiv,
  Mod,
  Add,
  Sub,
  ASL,
  ASR,
  LSR,
  LT,
  LE,
  GT,
  GE,
  NE,
  EQ,
  BitAnd,
  BitXor,
  BitOr,
  LogAnd,
  LogXor,
  LogOr,

  // parens, brackets, braces
  Group

  // TODO: maybe support Ternary for DASM?
}

export type OpDef = {
  pre: number     // precedence
  op: Op
  ra?: boolean    // right associative
  end?: string    // match to opening paren, etc.
}

export type KeywordDef = {
  create?: () => stm.Statement
}

export class SyntaxDef {
  public keywordMap: Map<string, KeywordDef> = new Map<string, KeywordDef>()
  public unaryOpMap: Map<string, OpDef> = new Map<string, OpDef>()
  public binaryOpMap: Map<string, OpDef> = new Map<string, OpDef>()

  // *** integrate documentation? ***
}

//------------------------------------------------------------------------------

class UnknownSyntax extends SyntaxDef {

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
    ])

    // NOTE: default precedence roughly based on C++

    this.unaryOpMap = new Map<string, OpDef>([
      // scoped labels { pre: 20 }
      // special functions { pre: 19 }

      [ "+",         { pre: 18, op: Op.Pos      }],
      [ "-",         { pre: 18, op: Op.Neg      }],
      [ "~",         { pre: 18, op: Op.BitNot   }],
      [ ".BITNOT",   { pre: 18, op: Op.BitNot   }], // CA65-only
      [ "!",         { pre: 18, op: Op.LogNot   }],
      [ ".NOT",      { pre: 18, op: Op.LogNot   }], // CA65-only
      [ "NOT",       { pre: 18, op: Op.LogNot   }], // ACME-only

      [ "<",         { pre: 18, op: Op.LowByte  }],
      [ ".LOBYTE",   { pre: 18, op: Op.LowByte  }], // CA65-only
      [ ">",         { pre: 18, op: Op.HighByte }],
      [ ".HIBYTE",   { pre: 18, op: Op.HighByte }], // CA65-only
      [ "^",         { pre: 18, op: Op.BankByte }],
      [ ".BANKBYTE", { pre: 18, op: Op.BankByte }], // CA65-only

      [ "(",         { pre: 0,  op: Op.Group, end: ")" }],
      [ "[",         { pre: 0,  op: Op.Group, end: "]" }],
      // [ "{",         { pre: 0,  op: Op.Group, end: "}" }],
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "^",         { pre: 17, op: Op.Pow   }], // ACME-only

      [ "*",         { pre: 16, op: Op.Mul   }],
      [ "/",         { pre: 16, op: Op.IDiv  }],
      [ "DIV",       { pre: 16, op: Op.IDiv  }],  // ACME-only
      [ "%",         { pre: 16, op: Op.Mod   }],
      [ "MOD",       { pre: 16, op: Op.Mod   }],  // ACME-only

      [ "+",         { pre: 15, op: Op.Add   }],
      [ "-",         { pre: 15, op: Op.Sub   }],

      [ "<<",        { pre: 14, op: Op.ASL   }],
      [ "ASL",       { pre: 14, op: Op.ASL   }],  // ACME-only
      [ "LSL",       { pre: 14, op: Op.ASL   }],  // ACME-only
      [ ">>",        { pre: 14, op: Op.ASR   }],
      [ "ASR",       { pre: 14, op: Op.ASR   }],
      [ ">>>",       { pre: 14, op: Op.LSR   }],  // ACME-only
      [ "LSR",       { pre: 14, op: Op.LSR   }],  // ACME-only

      [ "<=",        { pre: 12, op: Op.LE    }],
      [ "<",         { pre: 12, op: Op.LT    }],
      [ ">=",        { pre: 12, op: Op.GE    }],
      [ ">",         { pre: 12, op: Op.GT    }],

      [ "!=",        { pre: 10, op: Op.NE    }],
      [ "<>",        { pre: 10, op: Op.NE    }],
      [ "><",        { pre: 10, op: Op.NE    }],  // ACME-only
      [ "=",         { pre: 10, op: Op.EQ    }],
      [ "==",        { pre: 10, op: Op.EQ    }],  // DASM-only

      [ "&",         { pre: 9, op: Op.BitAnd }],
      [ ".BITAND",   { pre: 9, op: Op.BitAnd }],  // CA65-only
      [ "AND",       { pre: 9, op: Op.BitAnd }],  // ACME-only (not Op.LogAnd)

      [ "^",         { pre: 8, op: Op.BitXor }],
      [ "!",         { pre: 8, op: Op.BitXor }],  // Merlin-only
      [ ".BITXOR",   { pre: 8, op: Op.BitXor }],  // CA65-only
      [ "XOR",       { pre: 8, op: Op.BitXor }],  // ACME-only (not Op.LogXor)

      [ "|",         { pre: 7, op: Op.BitOr  }],
      [ ".BITOR",    { pre: 7, op: Op.BitOr  }],  // CA65-only
      [ "OR",        { pre: 7, op: Op.BitOr  }],  // ACME-only (not Op.LogOr)

      [ "&&",        { pre: 6, op: Op.LogAnd }],
      [ ".AND",      { pre: 6, op: Op.LogAnd }],  // CA65-only

      [ ".XOR",      { pre: 5, op: Op.LogXor }],  // CA65-only

      [ "||",        { pre: 4, op: Op.LogOr  }],
      [ ".OR",       { pre: 4, op: Op.LogOr  }],  // CA65-only

      // 3 Ternary
      // 2 ","
    ])
  }
}

//------------------------------------------------------------------------------
// MERLIN
//------------------------------------------------------------------------------
//  Precedence:
//    https://archive.org/details/Merlin_816_Macro_Assembler_Manual/page/n91
//
//    Evaluated left to right, parenthesis not allowed
//------------------------------------------------------------------------------

class MerlinSyntax extends SyntaxDef {

  constructor() {
    super()

    // *** padded name too? just flag? ***
    this.keywordMap = new Map<string, KeywordDef>([
      [ "xc",     {}],
      [ "org",    { create: () => { return new stm.OrgStatement() }}],
      [ "equ",    { create: () => { return new stm.EquStatement() }}],
      [ "=",      { create: () => { return new stm.EquStatement() }}],
      [ "err",    { create: () => { return new stm.ErrorStatement() }}],

      // disk
      [ "put",    { create: () => { return new stm.IncludeStatement() }}],
      [ "use",    { create: () => { return new stm.IncludeStatement() }}],
      [ "sav",    { create: () => { return new stm.SaveStatement() }}],
      [ "dsk",    {}],

      // macros
      [ "mac",    { create: () => { return new stm.MacroDefStatement() }}],
      [ "eom",    { create: () => { return new stm.EndMacroDefStatement() }}],
      [ "<<<",    { create: () => { return new stm.EndMacroDefStatement() }}],

      [ "dum",    { create: () => { return new stm.DummyStatement() }}],
      [ "dummy",  { create: () => { return new stm.DummyStatement() }}],
      [ "dend",   { create: () => { return new stm.DummyEndStatement() }}],
      [ "usr",    { create: () => { return new stm.UsrStatement() }}],
      [ "lup",    {}],

      // data storage
      [ "db",     { create: () => { return new stm.ByteDataStatement() }}],
      [ "dfb",    { create: () => { return new stm.ByteDataStatement() }}],
      [ "ddb",    { create: () => { return new stm.WordDataStatement(true) }}],
      [ "dw",     { create: () => { return new stm.WordDataStatement() }}],
      [ "da",     { create: () => { return new stm.WordDataStatement() }}],
      [ "ds",     { create: () => { return new stm.ByteStorageStatement() }}],
      [ "hex",    { create: () => { return new stm.HexStatement() }}],

      [ "asc",    {}],
      [ "dci",    {}],
      [ "rev",    {}],
      [ "str",    {}],

      // conditionals
      [ "do",     { create: () => { return new stm.IfStatement() }}],
      [ "else",   { create: () => { return new stm.ElseStatement() }}],
      [ "fin",    { create: () => { return new stm.EndIfStatement() }}],

      [ "tr",     { create: () => { return new stm.ListStatement() }}],
      [ "lst",    { create: () => { return new stm.ListStatement() }}],
      [ "lstdo",  { create: () => { return new stm.ListStatement() }}],
      [ "exp",    { create: () => { return new stm.ListStatement() }}],
      [ "page",   { create: () => { return new stm.ListStatement() }}],
      [ "obj",    {}],
      [ "end",    {}],
      [ "ent",    { create: () => { return new stm.EntryStatement() }}],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "-",   { pre: 10, op: Op.Neg      }],

      // TODO: should these be included?
      [ "<",   { pre: 10, op: Op.LowByte  }],
      [ ">",   { pre: 10, op: Op.HighByte }],
      [ "^",   { pre: 10, op: Op.BankByte }]
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",   { pre: 10, op: Op.Mul      }],
      [ "/",   { pre: 10, op: Op.IDiv     }],
      [ "+",   { pre: 10, op: Op.Add      }],
      [ "-",   { pre: 10, op: Op.Sub      }],
      [ "&",   { pre: 10, op: Op.BitAnd   }],
      [ "!",   { pre: 10, op: Op.BitXor   }],
      [ ".",   { pre: 10, op: Op.BitOr    }]
    ])
  }
}

//------------------------------------------------------------------------------
// DASM
//------------------------------------------------------------------------------
//  Precedence:
//    https://github.com/dasm-assembler/dasm/blob/master/docs/dasm.pdf
//    Page 24, 25
//
//  All directives (and incidentally also the mnemonics) can be prefixed with
//  a dot "." or a crosshatch "#" for compatibility with other assemblers. So,
//  ".IF" is the same as "IF" and "#IF".
//
//------------------------------------------------------------------------------

class DasmSyntax extends SyntaxDef {

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ "processor",  {}],
      [ "org",        { create: () => { return new stm.OrgStatement() }}],
      [ "equ",        { create: () => { return new stm.EquStatement() }}],
      [ "=",          { create: () => { return new stm.EquStatement() }}],
      [ "err",        { create: () => { return new stm.ErrorStatement() }}],

      // disk
      [ "include",    { create: () => { return new stm.IncludeStatement() }}],

      // macros
      [ "mac",        { create: () => { return new stm.MacroDefStatement() }}],
      [ "macro",      { create: () => { return new stm.MacroDefStatement() }}],
      [ "endm",       { create: () => { return new stm.EndMacroDefStatement() }}],

      [ "seg",        {}],
      [ "repeat",     {}],
      [ "repend",     {}],
      [ "echo",       {}],

      // data storage
      [ "ds",         { create: () => { return new stm.ByteStorageStatement() }}],
      [ "ds.b",       { create: () => { return new stm.ByteStorageStatement() }}],
      [ "ds.w",       { create: () => { return new stm.WordStorageStatement() }}],
      [ "ds.s",       { create: () => { return new stm.WordStorageStatement(true) }}],
      [ "dc",         { create: () => { return new stm.ByteDataStatement() }}],
      [ "dc.b",       { create: () => { return new stm.ByteDataStatement() }}],
      [ "dc.w",       { create: () => { return new stm.WordDataStatement() }}],
      [ "dc.s",       { create: () => { return new stm.WordDataStatement(true) }}],
      [ ".byte",      { create: () => { return new stm.ByteDataStatement() }}],
      [ ".word",      { create: () => { return new stm.WordDataStatement() }}],
      [ "hex",        { create: () => { return new stm.HexStatement() }}],
      [ "align",      {}],

      // conditionals
      [ "if",         { create: () => { return new stm.IfStatement() }}],
      [ "ifconst",    { create: () => { return new stm.IfDefStatement(true) }}],
      [ "ifnconst",   { create: () => { return new stm.IfDefStatement(false) }}],
      [ "else",       { create: () => { return new stm.ElseStatement() }}],
      [ "elif",       { create: () => { return new stm.ElseIfStatement() }}],
      [ "endif",      { create: () => { return new stm.EndIfStatement() }}],
      [ "eif",        { create: () => { return new stm.EndIfStatement() }}],

      // scope
      [ "subroutine", { create: () => { return new stm.ZoneStatement() }}],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "~",   { pre: 20, op: Op.BitNot   }], // bitwise NOT
      [ "-",   { pre: 20, op: Op.Neg      }], // negation
      [ "!",   { pre: 20, op: Op.LogNot   }], // logical NOT
      [ "<",   { pre: 20, op: Op.LowByte  }], // low-byte
      [ ">",   { pre: 20, op: Op.HighByte }], // high-byte
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",   { pre: 19, op: Op.Mul      }], // Multiplication
      [ "/",   { pre: 19, op: Op.IDiv     }], // Division (integer)
      [ "%",   { pre: 19, op: Op.Mod      }], // Modulus
      [ "+",   { pre: 18, op: Op.Add      }], // Addition
      [ "-",   { pre: 18, op: Op.Sub      }], // Subtraction
      [ ">>",  { pre: 17, op: Op.ASR      }], // Arithmetic shift right
      [ "<<",  { pre: 17, op: Op.ASL      }], // Arithmetic shift left
      [ ">",   { pre: 16, op: Op.GT       }], // Greater than
      [ ">=",  { pre: 16, op: Op.GE       }], // Greater than or equal to
      [ "<",   { pre: 16, op: Op.LT       }], // Less than
      [ "<=",  { pre: 16, op: Op.LE       }], // Less than or equal to
      [ "==",  { pre: 15, op: Op.EQ       }], // Logical equal to.
      [ "=",   { pre: 15, op: Op.EQ       }], // Logical equal to. Deprecated! (use ‘==’)
      [ "!=",  { pre: 15, op: Op.NE       }], // Not equal to
      [ "&",   { pre: 14, op: Op.BitAnd   }], // Arithmetic AND
      [ "^",   { pre: 13, op: Op.BitXor   }], // Arithmetic XOR
      [ "|",   { pre: 12, op: Op.BitOr    }], // Arithmetic OR
      [ "&&",  { pre: 11, op: Op.LogAnd   }], // Logical AND. Evaluates as 0 or 1
      [ "||",  { pre: 10, op: Op.LogOr    }], // Logical OR. Evaluates as 0 or 1
    ])

    /*
      9      ?           If the left expression is TRUE, result is the right
                          expression, else result is 0. [10?20] returns 20.
                          The function of the C conditional operator a?b:c
                          can be achieved by using [a?b-c]+c.
                          expression, else result is 0. [10?20] returns 20.
                          The function of the C conditional operator a?b:c
                          can be achieved by using [a?b-c]+c.
      8      [ ]         Group expressions (used in place of parenthesis)
      7      ,           Separates expressions in list (also used in
                          addressing mode resolution, so be careful!)

      "It is possible to use round brackets () instead of square brackets [] in
      expressions following directives, but not following mnemonics.
      Use square brackets [] when you are unsure."
    */
  }
}

//------------------------------------------------------------------------------
// ACME
//------------------------------------------------------------------------------
//  Precedence:
//    https://github.com/meonwax/acme/blob/master/docs/QuickRef.txt
//    (Section: The maths parser)
//------------------------------------------------------------------------------

class AcmeSyntax extends SyntaxDef {

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ "!cpu",       {}],
      [ "*",          { create: () => { return new stm.OrgStatement() }}],

      // disk
      [ "!source",    {}],
      [ "!to",        {}],

      // macros
      [ "!mac",       { create: () => { return new stm.MacroDefStatement() }}],
      [ "!macro",     { create: () => { return new stm.MacroDefStatement() }}],

      // data storage
      [ "!byte",      { create: () => { return new stm.ByteDataStatement() }}],
      [ "!word",      { create: () => { return new stm.WordDataStatement() }}],
      [ "!fill",      {}],
      [ "!align",     {}],

      [ "!convtab",   {}],
      [ "!pseudopc",  {}],

      // conditionals
      [ "!if",        { create: () => { return new stm.IfStatement() }}],

      // scope
      [ "!zone",      { create: () => { return new stm.ZoneStatement() }}],

      // messages
      [ "!serious",   {}],
    ])

    /*
      14     sin(v)      Trigonometric sine function
      14     cos(v)      Trigonometric cosine function
      14     tan(v)      Trigonometric tangent function
      14     arcsin(v)   Inverse of sin()
      14     arccos(v)   Inverse of cos()
      14     arctan(v)   Inverse of tan()
      14     address(v)  Mark as address           addr(v)
      14     int(v)      Convert to integer
      14     float(v)    Convert to float
    */

    this.unaryOpMap = new Map<string, OpDef>([
      [ "!",   { pre: 13, op: Op.LogNot   }], // Complement of
      [ "NOT", { pre: 13, op: Op.LogNot   }], // Complement of
      [ "-",   { pre: 11, op: Op.Neg      }], // Negate
      [ "<",   { pre:  7, op: Op.LowByte  }], // Lowbyte of
      [ ">",   { pre:  7, op: Op.HighByte }], // Highbyte of
      [ "^",   { pre:  7, op: Op.BankByte }], // Bankbyte of
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "^",   { pre: 12, op: Op.Pow      }], // To the power of
      [ "*",   { pre: 10, op: Op.Mul      }], // Multiply
      [ "/",   { pre: 10, op: Op.FDiv     }], // Divide (floating point!)
      [ "DIV", { pre: 10, op: Op.IDiv     }], // Integer-Divide
      [ "%",   { pre: 10, op: Op.Mod      }], // Remainder of DIV
      [ "MOD", { pre: 10, op: Op.Mod      }], // Remainder of DIV
      [ "+",   { pre:  9, op: Op.Add      }], // Add
      [ "-",   { pre:  9, op: Op.Sub      }], // Subtract
      [ "<<",  { pre:  8, op: Op.ASL      }], // Shift left
      [ "ASL", { pre:  8, op: Op.ASL      }], // Shift left
      [ "LSL", { pre:  8, op: Op.ASL      }], // Shift left
      [ ">>",  { pre:  8, op: Op.ASR      }], // Arithmetic shift right
      [ "ASR", { pre:  8, op: Op.ASR      }], // Arithmetic shift right
      [ ">>>", { pre:  8, op: Op.LSR      }], // Logical shift right
      [ "LSR", { pre:  8, op: Op.LSR      }], // Logical shift right
      [ "<=",  { pre:  6, op: Op.LE       }], // Lower or equal
      [ "<",   { pre:  6, op: Op.LT       }], // Lower than
      [ ">=",  { pre:  6, op: Op.GE       }], // Higher or equal
      [ ">",   { pre:  6, op: Op.GT       }], // Higher than
      [ "!=",  { pre:  5, op: Op.NE       }], // Not equal
      [ "<>",  { pre:  5, op: Op.NE       }], // Not equal
      [ "><",  { pre:  5, op: Op.NE       }], // Not equal
      [ "=",   { pre:  4, op: Op.EQ       }], // Equal
      [ "&",   { pre:  3, op: Op.BitAnd   }], // Bit-wise AND
      [ "AND", { pre:  3, op: Op.BitAnd   }], // Bit-wise AND
      [ "XOR", { pre:  2, op: Op.BitXor   }], // Bit-wise XOR
      [ "|",   { pre:  1, op: Op.BitOr    }], // Bit-wise OR
      [ "OR",  { pre:  1, op: Op.BitOr    }], // Bit-wise OR
    ])
  }
}

//------------------------------------------------------------------------------
// CA65
//------------------------------------------------------------------------------
//  Precedence:
//    https://cc65.github.io/doc/ca65.html#ss5.5
//
//    NOTE: precedence reversed from 0->7 to 8->1
//------------------------------------------------------------------------------

class Ca65Syntax extends SyntaxDef {

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ ".org",     { create: () => { return new stm.OrgStatement() }}],

      // macros
      [ ".mac",       { create: () => { return new stm.MacroDefStatement() }}],
      [ ".macro",     { create: () => { return new stm.MacroDefStatement() }}],
      [ ".endmac",    { create: () => { return new stm.EndMacroDefStatement() }}],
      [ ".endmacro",  { create: () => { return new stm.EndMacroDefStatement() }}],

      // ***
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
// LISA 2.5
//------------------------------------------------------------------------------
//  Precedence:
//    https://archive.org/details/LISAAssemblerVersion2.5ManualPhotocopySource/page/n9
//
//    Evaluated from RIGHT TO LEFT(!), parenthesis are not allowed
//------------------------------------------------------------------------------
/*
  NOTE: '!' is the optional prefix for decimal numbers.
      Negative numbers must have it ("!-2", for example)
*/

class LisaSyntax extends SyntaxDef {

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      [ "org",  { create: () => { return new stm.OrgStatement() }}],
      [ "equ",  { create: () => { return new stm.EquStatement() }}],
      [ "=",    { create: () => { return new stm.EquStatement() }}],

      // disk
      [ "icl",  { create: () => { return new stm.IncludeStatement() }}],
      [ "sav",  { create: () => { return new stm.SaveStatement() }}],

      // data storage
      [ "da",   { create: () => { return new stm.WordDataStatement() }}],
      [ "hex",  { create: () => { return new stm.HexStatement() }}],

      [ "str",  {}],
      [ "lst",  {}],
      [ "obj",  {}],
      [ "end",  {}],
      [ "dcm",  {}],
      [ "nls",  {}],
      [ "epz",  {}],
      [ "adr",  {}],
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      // TODO: no unary negate?
      // NOTE: "/" handled directly in OpStatement parsing
    ])

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",   { pre: 10, op: Op.Mul,      ra: true }],
      [ "/",   { pre: 10, op: Op.IDiv,     ra: true }],
      [ "+",   { pre: 10, op: Op.Add,      ra: true }],
      [ "-",   { pre: 10, op: Op.Sub,      ra: true }],
      [ "=",   { pre: 10, op: Op.EQ,       ra: true }],
      [ "#",   { pre: 10, op: Op.NE,       ra: true }],
      // NOTE: docs say "Logical AND", etc. but probably mean Bitwise
      [ "&",   { pre: 10, op: Op.BitAnd,   ra: true }],
      [ "^",   { pre: 10, op: Op.BitXor,   ra: true }],
      [ "|",   { pre: 10, op: Op.BitOr,    ra: true }]
    ])
  }
}

//------------------------------------------------------------------------------

export const enum Syntax {
  UNKNOWN = 0,    // must be zero
  MERLIN  = 1,
  DASM    = 2,
  CA65    = 3,
  ACME    = 4,
  LISA    = 5,
}

export const SyntaxMap = new Map<string, number>([
  [ "UNKNOWN", 0 ],
  [ "MERLIN",  1 ],
  [ "DASM",    2 ],
  [ "CA65",    3 ],
  [ "ACME",    4 ],
  [ "LISA",    5 ],
])

export const SyntaxDefs: SyntaxDef[] = [
  new UnknownSyntax(),
  new MerlinSyntax(),
  new DasmSyntax(),
  new Ca65Syntax(),
  new AcmeSyntax(),
  new LisaSyntax()
]

//------------------------------------------------------------------------------
