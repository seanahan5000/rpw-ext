
import { SyntaxDef, KeywordDef, OpDef, Op } from "./syntax_types"
import * as stm from "../statements"

//------------------------------------------------------------------------------
// ORCA/M
//------------------------------------------------------------------------------
//  Precedence:
//    ***
//------------------------------------------------------------------------------

export class OrcaMSyntax extends SyntaxDef {

  public symbolTokenPrefixes = ".~"
  public symbolTokenContents = ""
  public cheapLocalPrefixes = ""
  public zoneLocalPrefixes = ""
  public anonLocalChars = ""
  public namedParamPrefixes = ""
  public keywordPrefixes = ""
  public keywordsInColumn1 = false
  public macroInvokePrefixes = ""
  public macroInvokeDelimiters = ","
  public allowLabelTrailingColon = false
  public allowIndentedAssignment = false
  public allowLineContinuation = false
  public stringEscapeChars = ""
  public scopeSeparator = ""
  public defaultOrg = 0x0800        // TODO: choose correct value

  constructor() {
    super()

    this.keywordMap = new Map<string, KeywordDef>([
      // target
      [ "65c02",      { // TODO:
                        params: "{on|off}",
                        desc:   "Enable 65C02 code" } ],
      [ "65816",      { // TODO:
                        params: "{on|off}",
                        desc:   "Enable 65816 code" } ],

      // equates
      [ "equ",        { create: () => { return new stm.EquStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Define a local label and set it equal to a value" } ],
      [ "gequ",       { create: () => { return new stm.EquStatement() },
                        label:  "<symbol>",
                        params: "<expression>",
                        desc:   "Define a global label and set it equal to a value" } ],
      [ "entry",      { // TODO
                        label:  "<symbol>",
                        params: "",
                        desc: "Define an alternate entry point into a segment" } ],
      // [ "=",          { alias: "equ" }],
      // [ "set",        { create: () => { return new stm.VarAssignStatement() },
      //                   label:  "<symbol>",
      //                   params: "<expression>",
      //                   desc:   "Change value of reassignable symbol" } ],
      // [ "eqm",        { // TODO
      //                   label:  "<symbol>",
      //                   params: "<expression>",
      //                   desc:   "Assign expression string to symbol" } ],
      // [ "setstr",     { // TODO
      //                   label:  "<symbol>",
      //                   params: "<expression>",
      //                   desc:   "Change var to expression as string to symbol" } ],

      // pc
      [ "org",        { create: () => { return new stm.OrgStatement() },
                        params: "<expression>",
                        desc:   "Designate origin" } ],
      // [ "rorg",       { // TODO
      //                   params: "<expression>",
      //                   desc:   "Activate the relocatable origin" } ],
      // [ "rend",       { // TODO
      //                   params: "",
      //                   desc:   "Deactivate the relocatable origin" } ],

      // disk
      [ "copy",       { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Copy a source file" } ],
      [ "append",     { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Append a file" } ],
      [ "keep",       { // TODO
                        params: "<filename>",
                        desc:   "Keep object file" } ],

      [ "mcopy",      { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Copy macro library" } ],
      [ "mload",      { create: () => { return new stm.IncludeStatement() },
                        params: "<filename>",
                        desc:   "Load macro library" } ],
      [ "mdrop",      { // TODO
                        params: "<filename>",
                        desc:   "Drop macro library" } ],

      // macros
      [ "macro",      { create: () => { return new stm.MacroDefStatement() },
                        label:  "",
                        params: "",
                        desc:   "Begin a macro definition" } ],
      [ "mend",       { create: () => { return new stm.EndMacroDefStatement() },
                        label:  "",
                        params: "",
                        desc:   "End a macro definition" } ],
      [ "mexit",      { // TODO
                        params: "",
                        desc:   "Exit macro" } ],
      [ "mnote",      { // TODO
                        params: "<message> [,<num>]",
                        desc:   "Exit macro" } ],

      // conditionals
      [ "actr",       { // TODO:
                        label:  "",
                        params: "<number>",
                        desc:   "Assembly counter" } ],
      [ "ago",        { // TODO:
                        label:  "",
                        params: "<symbol>",
                        desc:   "Assembler go" } ],
      [ "aif",        { // TODO:
                        label:  "",
                        params: "<conditional>,<symbol>",
                        desc:   "Assembler if" } ],
      [ "ainput",     { // TODO:
                        label:  "<amper-sym>",
                        params: "[<string>]",
                        desc:   "Assembler input" } ],
      [ "amid",       { // TODO:
                        label:  "<amper-sym>",
                        params: "<search>,<target>,<pos>",
                        desc:   "Assembler mid string" } ],
      [ "asearch",    { // TODO:
                        label:  "<amper-sym>",
                        params: "<string>,<pos>,<num>",
                        desc:   "Assembler string search" } ],

      [ "gbla",       { // TODO:
                        label:  "",
                        params: "<amper-sym>",
                        desc:   "Define global arithmetic parameter" } ],
      [ "gblb",       { // TODO:
                        label:  "",
                        params: "<amper-sym>",
                        desc:   "Define global boolean parameter" } ],
      [ "gblc",       { // TODO:
                        label:  "",
                        params: "<amper-sym>",
                        desc:   "Define global character parameter" } ],
      [ "lcla",       { // TODO:
                        label:  "",
                        params: "<amper-sym>",
                        desc:   "Define local arithmetic parameter" } ],
      [ "lclb",       { // TODO:
                        label:  "",
                        params: "<amper-sym>",
                        desc:   "Define local boolean parameter" } ],
      [ "lclc",       { // TODO:
                        label:  "",
                        params: "<amper-sym>",
                        desc:   "Define local character parameter" } ],

      [ "seta",       { // TODO:
                        label:  "<amper-sym>",
                        params: "<expression>",
                        desc:   "Set arithmetic parameter" } ],
      [ "setb",       { // TODO:
                        label:  "<amper-sym>",
                        params: "<expression>",
                        desc:   "Set boolean parameter" } ],
      [ "setc",       { // TODO:
                        label:  "<amper-sym>",
                        params: "<expression>",
                        desc:   "Set character parameter" } ],

      // segments
      [ "start",      { create: () => { return new stm.SegmentStatement() },
                        label: "<symbol>",
                        params: "[<loadseg>]",
                        desc:   "Start segment" } ],
      [ "end",        { // TODO:
                        params: "",
                        desc:   "End program segment" } ],
      [ "using",      { create: () => { return new stm.SegmentStatement() },
                        params: "<name>",
                        desc:   "Using data segment" } ],
      [ "data",       { // TODO
                        label:  "<symbol>",
                        params: "[<name>]",
                        desc:   "Define data segment" } ],
      [ "using",      { // TODO
                        params: "[<name>]",
                        desc:   "Using data segment" } ],
      [ "kind",       { // TODO
                        params: "<number>",
                        desc:   "Specify object segment type and attributes" } ],

      [ "obj",        { // TODO
                        params: "<expression>",
                        desc:   "Designate destination" } ],
      [ "objend",     { // TODO
                        params: "",
                        desc:   "End destination segment" } ],
      [ "private",    { // TODO
                        label:  "<symbol>",
                        params: "[<name>]",
                        desc:   "Define a private code segment" } ],
      [ "privdata",   { // TODO
                        label:  "<symbol>",
                        params: "[<name>]",
                        desc:   "Define a private data segment" } ],

      // import/export
      [ "entry",      { // TODO
                        label:  "<symbol>",
                        params: "",
                        desc:   "Define entry point" } ],

      // data storage
      [ "ds",         { create: () => { return new stm.StorageStatement(1) },
                        params: "<count>",
                        desc:   "Define storage" } ],
      [ "dc",         { create: () => { return new stm.DataStatement_X8() },
                        params: "<condef>[, <condef> ...]",
                        desc:   "Declare constant" } ],
      [ "align",      { create: () => { return new stm.AlignStatement() },
                        params: "<boundary>",
                        desc:   "Align to a boundary" } ],

      // [ "if",         { create: () => { return new stm.IfStatement() },
      //                   params: "<condition>",
      //                   desc:   "Compile if condition is true" } ],
      // [ "ifconst",    { create: () => { return new stm.IfConstStatement(true) },
      //                   params: "<condition>",
      //                   desc:   "Compile if condition is constant" } ],
      // [ "ifnconst",   { create: () => { return new stm.IfConstStatement(false) },
      //                   params: "<condition>",
      //                   desc:   "Compile if condition is not constant" } ],
      // [ "else",       { create: () => { return new stm.ElseStatement() },
      //                   params: "",
      //                   desc:   "Compile if previous conditions were not met" } ],
      // [ "elif",       { create: () => { return new stm.ElseIfStatement() },
      //                   params: "<condition>",
      //                   desc:   "Compile if previous conditions were not met and the condition is true" } ],
      // [ "endif",      { create: () => { return new stm.EndIfStatement() },
      //                   params: "",
      //                   desc:   "End of conditional compilation" } ],
      // [ "eif",        { alias: "endif" }],

      // // looping
      // [ "repeat",     { create: () => { return new stm.RepeatStatement() },
      //                   params: "<expression>",
      //                   desc:   "Start of repeated block" } ],
      // [ "repend",     { create: () => { return new stm.EndRepStatement() },
      //                   params: "",
      //                   desc:   "End of repeat block" } ],

      // // scope
      // [ "subroutine", { create: () => { return new stm.SubroutineStatement() },
      //                   params: "",
      //                   desc:   "Set boundary that resets the scope of local labels" } ],

      // misc
      [ "list",       { // TODO:
                        params: "{on|off}",
                        desc:   "List output" } ],
      [ "eject",      { // TODO:
                        params: "",
                        desc:   "Eject the page" } ],
      [ "title",      { // TODO:
                        params: "[<string>]",
                        desc:   "Print header" } ],

      [ "absaddr",    { // TODO:
                        params: "{on|off}",
                        desc:   "Allow absolute address" } ],
      [ "anop",       { // TODO:
                        params: "",
                        desc:   "Assembler no operation" } ],
      [ "case",       { // TODO:
                        params: "{on|off}",
                        desc:   "Specify case sensitivity" } ],
      [ "codechk",    { // TODO:
                        params: "{on|off}",
                        desc:   "Tell linker to check jump instructions" } ],
      [ "datachk",    { // TODO:
                        params: "{on|off}",
                        desc:   "Check data references" } ],
      [ "direct",     { // TODO:
                        params: "{off|<expression>}",
                        desc:   "Set direct page value" } ],
      [ "dynchk",     { // TODO:
                        params: "{on|off}",
                        desc:   "Check references to dynamic segments" } ],
      [ "err",        { // TODO:
                        params: "{on|off}",
                        desc:   "Print errors" } ],
      [ "expand",     { // TODO:
                        params: "{on|off}",
                        desc:   "Expand DC statements" } ],
      [ "gen",        { // TODO:
                        label:  "",
                        params: "{on|off}",
                        desc:   "Generate macro expansions" } ],
      [ "ieee",       { // TODO:
                        params: "{on|off}",
                        desc:   "Generator IEEE format numbers" } ],
      [ "instime",    { // TODO:
                        params: "{on|off}",
                        desc:   "Show instruction times" } ],
      [ "longa",      { // TODO:
                        params: "{on|off}",
                        desc:   "Select accumulator size" } ],
      [ "longi",      { // TODO:
                        params: "{on|off}",
                        desc:   "Select index register size" } ],
      [ "merr",       { // TODO:
                        params: "<expression>",
                        desc:   "Maximum error level" } ],
      [ "msb",        { // TODO:
                        params: "{on|off}",
                        desc:   "Most significant character bit" } ],
      [ "numsex",     { // TODO:
                        params: "{on|off}",
                        desc:   "Set floating point byte order" } ],
      [ "objcase",    { // TODO:
                        params: "{on|off}",
                        desc:   "Specify case sensitivity in object files" } ],
      [ "printer",    { // TODO:
                        params: "{on|off}",
                        desc:   "Send output to printer" } ],

      [ "rename",     { // TODO:
                        label:  "",
                        params: "<oldop>,<newop>",
                        desc:   "Rename operation codes" } ],
      [ "setcom",     { // TODO:
                        params: "<expression>",
                        desc:   "Set comment column" } ],
      [ "symbol",     { // TODO:
                        params: "{on|off}",
                        desc:   "Print symbol tables" } ],
      [ "trace",      { // TODO:
                        label:  "",
                        params: "{on|off}",
                        desc:   "Trace macros" } ],

      // built-in macros

    ])

    this.unaryOpMap = new Map<string, OpDef>([
      [ ".not.",{ pre: 20, op: Op.BitNot   }], // bitwise NOT *** bitwise or logical? ***
      [ "-",    { pre: 20, op: Op.Neg      }], // negation
      // [ "!",   { pre: 20, op: Op.LogNot   }], // logical NOT
      [ "<",    { pre: 20, op: Op.LowByte  }], // low-byte
      [ ">",    { pre: 20, op: Op.HighByte }], // high-byte
      [ "^",    { pre: 20, op: Op.BankByte }], // bank-byte
      [ "(",    { pre: 0,  op: Op.Group, end: ")" }],
      // [ "{",   { pre: 0,  op: Op.Group, end: "}" }]
    ])

    // *** "/" support for high byte, like LISA ***

    this.binaryOpMap = new Map<string, OpDef>([
      [ "*",    { pre: 19, op: Op.Mul     }], // Multiplication
      [ "/",    { pre: 19, op: Op.IDiv    }], // Division (integer)
      [ ".and.",{ pre: 19, op: Op.BitAnd  }], // Arithmetic AND *** bitwise or logical? ***

      [ "+",    { pre: 18, op: Op.Add     }], // Addition
      [ "-",    { pre: 18, op: Op.Sub     }], // Subtraction
      [ ".or.", { pre: 18, op: Op.BitOr   }], // Arithmetic OR *** bitwise or logical? ***
      [ ".eor.",{ pre: 18, op: Op.BitXor  }], // Arithmetic XOR *** bitwise or logical? ***

      [ ">",   { pre: 16, op: Op.GT       }], // Greater than
      [ ">=",  { pre: 16, op: Op.GE       }], // Greater than or equal to
      [ "<",   { pre: 16, op: Op.LT       }], // Less than
      [ "<=",  { pre: 16, op: Op.LE       }], // Less than or equal to
      [ "<>",  { pre: 16, op: Op.NE       }], // Not equal to
      [ "=",   { pre: 15, op: Op.EQ       }], // Logical equal to

      // [ "%",   { pre: 19, op: Op.Mod      }], // Modulus
      // [ ">>",  { pre: 17, op: Op.ASR      }], // Arithmetic shift right
      // [ "<<",  { pre: 17, op: Op.ASL      }], // Arithmetic shift left
      // [ "==",  { pre: 15, op: Op.EQ       }], // Logical equal to.
      // [ "&&",  { pre: 11, op: Op.LogAnd   }], // Logical AND. Evaluates as 0 or 1
      // [ "||",  { pre: 10, op: Op.LogOr    }], // Logical OR. Evaluates as 0 or 1
    ])
  }
}

//------------------------------------------------------------------------------
