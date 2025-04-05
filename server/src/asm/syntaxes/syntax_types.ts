
import { Statement } from "../statements"
import { FunctionExpression } from "../functions"

//------------------------------------------------------------------------------

export const OpPatterns: string[] = [
  "<<",
  "<<<",
  ">>",
  ">>>",
  "<=",
  ">=",
  "==",
  "!=",
  "<>",
  "><",
  "&&",
  "||",
  "^^",
  ":=",
  "::",

  // specific to MERLIN
  "--^",

  // specific to syntaxes with +/- anonymous locals
  // TODO: add longer versions?
  "++",
  "+++",
  "++++",
  "+++++",
  "++++++",
  "--",
  "---",
  "----",
  "-----",
  "------",

  // specific to 64TASS
  ":?=",    // conditional assign
  // TODO: many more
]

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
  MI,
  PL,
  BitAnd,
  BitXor,
  BitOr,
  LogAnd,
  LogXor,
  LogOr,

  // parens, brackets, braces
  Group,

  // TODO: maybe support Ternary for DASM?
}

export type OpDef = {
  pre: number     // precedence
  op: Op
  ra?: boolean    // right associative
  end?: string    // match to opening paren, etc.
}

export type KeywordDef = {
  create?: () => Statement
  alias?: string
  label?: string
  params?: string
  desc?: string
  paramsList?: any    // ListParam
}

export type FunctionDef = {
  create?: () => FunctionExpression
  alias?: string
  params?: string
  desc?: string
  paramsList?: any    // ListParam
}

export type ParamDef = {
  params: string
  paramsList?: any    // ListParam
}

export class SyntaxDef {
  public paramDefMap: Map<string, ParamDef> = new Map<string, ParamDef>()
  public keywordMap: Map<string, KeywordDef> = new Map<string, KeywordDef>()
  public unaryOpMap: Map<string, OpDef> = new Map<string, OpDef>()
  public binaryOpMap: Map<string, OpDef> = new Map<string, OpDef>()

  // only CA65 currently supports/needs this
  public functionMap?: Map<string, FunctionDef> = new Map<string, FunctionDef>()

  // case sensitivity of symbols
  public caseSensitiveSymbols = false

  // leading operators that are considered part of a symbol/keyword/macro when tokenizing
  public symbolTokenPrefixes: string = ""

  // operators within token considered to be part of a symbol/keyword/macro when tokenizing
  public symbolTokenContents: string = ""

  public cheapLocalPrefixes: string = ""
  public zoneLocalPrefixes: string = ""
  public anonLocalChars: string = ""
  public namedParamPrefixes: string = ""

  // character before keyword
  public keywordPrefixes: string = ""

  // directives/keywords are allowed without indentation
  public keywordsInColumn1: boolean = true

  // character before the macro name being invoked
  public macroInvokePrefixes: string = ""

  // character between macro invoke parameters
  public macroInvokeDelimiters: string = ""

  public allowLabelTrailingColon: boolean = true

  public allowIndentedAssignment: boolean = true

  // support "\\" at the end of line
  public allowLineContinuation: boolean = false

  public stringEscapeChars: string = ""

  // normally "::" or "." for syntaxes that support scoping
  public scopeSeparator: string = ""

  // default org when none is provided (not all assemblers have one)
  // TODO: get rid of this completely?
  public defaultOrg?: number
}

//------------------------------------------------------------------------------

export const enum Syntax {
  UNKNOWN = 0,    // must be zero
  MERLIN  = 1,
  DASM    = 2,
  CA65    = 3,
  ACME    = 4,
  LISA    = 5,
  TASS64  = 6,
  ORCAM   = 7
}

export const SyntaxNames = [
  "UNKNOWN",
  "MERLIN",
  "DASM",
  "CA65",
  "ACME",
  "LISA",
  "64TASS",
  "ORCA/M"
]

export const SyntaxMap = new Map<string, number>([
  [ "UNKNOWN", Syntax.UNKNOWN ],
  [ "MERLIN",  Syntax.MERLIN  ],
  [ "DASM",    Syntax.DASM    ],
  [ "CA65",    Syntax.CA65    ],
  [ "ACME",    Syntax.ACME    ],
  [ "LISA",    Syntax.LISA    ],
  [ "64TASS",  Syntax.TASS64  ],
  [ "ORCA/M",  Syntax.ORCAM   ]
])

//------------------------------------------------------------------------------
