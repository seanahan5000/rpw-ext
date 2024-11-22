
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

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

export class DasmSyntax extends SyntaxDef {

  public symbolTokenPrefixes = "."
  public symbolTokenContents = "."
  public cheapLocalPrefixes = ""
  public zoneLocalPrefixes = "."
  public anonLocalChars = ""
  public namedParamPrefixes = ""
  public keywordPrefixes = ".#"
  public keywordsInColumn1 = true
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ","
  public allowLabelTrailingColon = true
  public allowIndentedAssignment = false
  public allowLineContinuation = false
  public stringEscapeChars = ""
  public scopeSeparator = ""
  public defaultOrg = 0x0800        // TODO: choose correct value

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      // target
      [ "processor",  { create: () => { return new stm.CpuStatement() },
                        params: "{ 6502 }",
                        desc:   "Set processor target" } ],

      [ "err",        { create: () => { return new stm.AssertTrueStatement("fatal", true) },
                        params: "",
                        desc:   "Abort assembly" } ],

      // equates
      [ "equ",        { create: () => { return new stm.EquStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Assign expression value to symbol" } ],
      [ "=",          { alias: "equ" }],
      [ "set",        { create: () => { return new stm.VarAssignStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Change value of reassignable symbol" } ],
      [ "eqm",        { // TODO
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Assign expression string to symbol" } ],
      [ "setstr",     { // TODO
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Change var to expression as string to symbol" } ],

      // pc
      [ "org",        { create: () => { return new stm.OrgStatement() },
                        params: "<expression>[, <fill>]",
                        desc:   "Set the current origin" } ],
      [ "rorg",       { // TODO
                        params: "<expression>",
                        desc:   "Activate the relocatable origin" } ],
      [ "rend",       { // TODO
                        params: "",
                        desc:   "Deactivate the relocatable origin" } ],

      // disk
      [ "include",    { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Insert source file" } ],
      [ "incdir",     { create: () => { return new stm.IncDirStatement() },
                        params: "<dirname>",
                        desc:   "Add given directory to search path" } ],
      [ "incbin",     { create: () => { return new stm.IncBinStatement() },
                        params: "<filename>[, <offset>]"}],

      // macros
      [ "macro",      { create: () => { return new stm.MacroDefStatement() },
                        label:  "",
                        params: "<type-name>",
                        desc:   "Start of macro definition" } ],
      [ "mac",        { alias: "macro" }],
      [ "endm",       { create: () => { return new stm.EndMacroDefStatement() },
                        label:  "",
                        params: "",
                        desc:   "End of macro definition" } ],
      [ "mexit",      { // TODO
                        params: "",
                        desc:   "Exit the current macro level" } ],

      // segments
      [ "seg",        { create: () => { return new stm.SegmentStatement() },
                        params: "[<name>]",
                        desc:   "Switch to new segment, creating if necessary" } ],
      [ "seg.u",      { alias:   "seg" } ],

      [ "echo",       { // TODO
                        params: "<expression>[, <expression> ...]",
                        desc:   "" } ],

      // data storage
      [ "ds",         { create: () => { return new stm.StorageStatement(1) },
                        params: "<count>[, <fill>]",
                        desc:   "Declare space and fill with value or 0" } ],
      [ "ds.b",       { create: () => { return new stm.StorageStatement(1) },
                        params: "<count>[, <fill>]",
                        desc:   "Declare space and fill with value or 0" } ],
      [ "ds.w",       { create: () => { return new stm.StorageStatement(2) },
                        params: "<count>[, <fill>]",
                        desc:   "Declare space and fill with value or 0" } ],
      [ "ds.l",       { create: () => { return new stm.StorageStatement(4) },
                        params: "<count>[, <fill>]",
                        desc:   "Declare space and fill with value or 0" } ],

      [ "dc",         { create: () => { return new stm.DataStatement_X8() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Declare byte data in the current segment" } ],
      [ "dc.b",       { create: () => { return new stm.DataStatement_X8() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Declare byte data in the current segment" } ],
      [ "dc.w",       { create: () => { return new stm.DataStatement_X16() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Declare word data in the current segment (little endian)" } ],
      [ "dc.l",       { create: () => { return new stm.DataStatement_U32() },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Declare long data in the current segment" } ],
      [ "dc.s",       { create: () => { return new stm.DataStatement_X16(true) },
                        params: "<expression>[, <expression> ...]",
                        desc:   "Declare word data in the current segment (big endian)" } ],

      [ "dv",         { // TODO
                        params: "<eqmlabel:symbol> <expression>[, <expression> ...]",
                        desc:   "Equivalent to DC but each expression is passed through eqmlabel" } ],
      [ "dv.b",       { // TODO
                        params: "<eqmlabel:symbol> <expression>[, <expression> ...]",
                        desc:   "Equivalent to DC but each expression is passed through eqmlabel" } ],
      [ "dv.w",       { // TODO
                        params: "<eqmlabel:symbol> <expression>[, <expression> ...]",
                        desc:   "Equivalent to DC but each expression is passed through eqmlabel" } ],
      [ "dv.l",       { // TODO
                        params: "<eqmlabel:symbol> <expression>[, <expression> ...]",
                        desc:   "Equivalent to DC but each expression is passed through eqmlabel" } ],

      [ "byte",       { alias: "dc.b" }],
      [ "word",       { alias: "dc.w" }],
      [ "long",       { alias: "dc.l" }],
      [ "hex",        { create: () => { return new stm.HexStatement() },
                        params: "<hex> [<hex> ...]",
                        desc:   "Raw hexidecimal data" } ],
      [ "align",      { create: () => { return new stm.AlignStatement() },
                        params: "<boundary>[, <fill>]",
                        desc:   "Align the current program counter to an n-byte boundary" } ],
      // RES not supported

      // conditionals
      [ "if",         { create: () => { return new stm.IfStatement() },
                        params: "<condition>",
                        desc:   "Compile if condition is true" } ],
      [ "ifconst",    { create: () => { return new stm.IfConstStatement(true) },
                        params: "<condition>",
                        desc:   "Compile if condition is constant" } ],
      [ "ifnconst",   { create: () => { return new stm.IfConstStatement(false) },
                        params: "<condition>",
                        desc:   "Compile if condition is not constant" } ],
      [ "else",       { create: () => { return new stm.ElseStatement() },
                        params: "",
                        desc:   "Compile if previous conditions were not met" } ],
      [ "elif",       { create: () => { return new stm.ElseIfStatement() },
                        params: "<condition>",
                        desc:   "Compile if previous conditions were not met and the condition is true" } ],
      [ "endif",      { create: () => { return new stm.EndIfStatement() },
                        params: "",
                        desc:   "End of conditional compilation" } ],
      [ "eif",        { alias: "endif" }],

      [ "end",        { // TODO:
                        params: "",
                        desc:   "End assembly immediately" } ],

      // looping
      [ "repeat",     { create: () => { return new stm.RepeatStatement() },
                        params: "<expression>",
                        desc:   "Start of repeated block" } ],
      [ "repend",     { create: () => { return new stm.EndRepStatement() },
                        params: "",
                        desc:   "End of repeat block" } ],

      // scope
      [ "subroutine", { create: () => { return new stm.SubroutineStatement() },
                        params: "",
                        desc:   "Set boundary that resets the scope of local labels" } ],

      // misc
      [ "list",       { create: () => { return new stm.ListStatement() },
                        params: "{off|on}",
                        desc:   "Globally turn listing on or off" } ]
    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ "~",   { pre: 20, op: Op.BitNot   }], // bitwise NOT
      [ "-",   { pre: 20, op: Op.Neg      }], // negation
      [ "!",   { pre: 20, op: Op.LogNot   }], // logical NOT
      [ "<",   { pre: 20, op: Op.LowByte  }], // low-byte
      [ ">",   { pre: 20, op: Op.HighByte }], // high-byte

      [ "(",   { pre: 0,  op: Op.Group, end: ")" }],
      [ "[",   { pre: 0,  op: Op.Group, end: "]" }],
      [ "{",   { pre: 0,  op: Op.Group, end: "}" }]
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
