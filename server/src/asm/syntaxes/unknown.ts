
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"

//------------------------------------------------------------------------------

export class UnknownSyntax extends SyntaxDef {

  public symbolTokenPrefixes = "!@:.]_"
  public symbolTokenContents = "."
  public cheapLocalPrefixes = "@:"
  public zoneLocalPrefixes = "."
  public anonLocalChars = "+-"
  public keywordPrefixes = ".!"
  public keywordsInColumn1 = true
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ","
  public allowLabelTrailingColon = true
  public allowIndentedAssignment = true
  public allowLineContinuation = true
  public stringEscapeChars = "\\'\"0tnrx"
  public scopeSeparator = "::"
  public defaultOrg = 0x0800

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
