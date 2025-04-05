
import { Parser } from "../parser"
import { Token, TokenType } from "../tokenizer"
import { SymbolType } from "../symbols"
import { Syntax, ParamDef } from "../syntaxes/syntax_types"
import * as exp from "../expressions"

// TODO: add ability to reparse with inMacroDef enabled,
//  and be forgiving of errors and recover

enum ParamType {
  List     = 0,
  Constant = 1,
  Term     = 2,
  OneOf    = 3,
  Optional = 4,
}

class Param {
  public paramType: ParamType
  public childParams?: Param[] = []
  public repeat: boolean

  private startPosition = 0
  private startIndex = 0

  constructor(paramType: ParamType, childParams?: Param[], repeat = false) {
    this.paramType = paramType
    this.childParams = childParams
    this.repeat = repeat
  }

  public parse(parser: Parser, parentName: string | undefined): boolean {
    if (this.childParams) {
      for (let param of this.childParams) {
        if (!param.parse(parser, parentName)) {
          return false
        }
      }
    }
    return true
  }

  protected savePosition(parser: Parser) {
    this.startPosition = parser.getPosition()
    this.startIndex = parser.nodeSet.length
  }

  protected restorePosition(parser: Parser) {
    parser.setPosition(this.startPosition)
    parser.nodeSet.splice(this.startIndex)
  }
}

export class ParamList extends Param {
  constructor(params: Param[]) {
    super(ParamType.List, params)
  }
}

class ConstantParam extends Param {

  public contents: string

  constructor(contents: string) {
    super(ParamType.Constant)
    this.contents = contents
  }

  parse(parser: Parser, parentName: string): boolean {
    const token = parser.getNextToken()
    if (token) {
      if (token.getString() == '"') {
        const expression = parser.parseStringExpression(token, parser.syntaxDef.stringEscapeChars)
        parser.addExpression(expression)
        if (expression.getString().toLowerCase() == this.contents) {
          expression.name = parentName
          return true
        }
        expression.setError("Unexpected expression: expected " + this.contents)
        return false
      }

      if (token.getString().toLowerCase() == this.contents) {
        if (token.type != TokenType.Operator) {
          token.type = TokenType.Keyword
        }

        // Only promote a contant up to a full expression if it
        //  has a name and still be searched for by a statement.
        if (parentName) {
          const expression = new exp.Expression([token])
          expression.name = parentName
          parser.addExpression(expression)
        } else {
          parser.addToken(token)
        }

        return true
      }
      token.setError("Unexpected expression: expected " + this.contents)
      parser.addToken(token)
    } else {
      parser.addMissingToken("expected " + this.contents)
    }
    return false
  }
}

class TermParam extends Param {

  public termName: string
  public termType: string

  constructor(termName: string, termType: string, params?: Param[]) {
    super(ParamType.Term, params)
    this.termName = termName
    this.termType = termType
  }

  parse(parser: Parser, parentName: string): boolean {

    if (this.childParams?.length) {
      return super.parse(parser, this.termName ?? parentName)
    }

    // parse term based on param type

    if (this.termType == "hex") {

      const token = parser.mustAddNextToken("expecting hex value")
      if (token.type != TokenType.Missing) {
        const hexString = token.getString().toUpperCase()
        if (hexString == "$") {
          token.setError("$ prefix not allowed on HEX statement values")
        } else if (token.type != TokenType.DecNumber && token.type != TokenType.HexNumber) {
          token.setError("Unexpected token type, expecting hex value")
        } else {
          token.type = TokenType.HexNumber
          if (hexString.length & 1) {
            token.setError("Odd number of nibbles")
          }
        }
      }
      if (token.hasError()) {
        parser.addExpression(new exp.BadExpression([token]))
        return false
      }

      const expression = new exp.Expression([token])
      expression.name = this.termName
      parser.addExpression(expression)
      return true
    }

    if (this.termType == "filename") {

      // TODO: quoting information (no quotes, single, double, <>, etc.)
      // TODO: check for quoted fileName, based on syntax
        // optional on DASM
        // never on MERLIN
      const fileName = parser.getNextFileNameExpression()
      if (!fileName) {
        parser.addMissingToken("expecting file name")
        return false
      }
      fileName.name = this.termName
      parser.addExpression(fileName)
      return true
    }

    if (this.termType == "string") {

      const token = parser.getNextToken()
      if (!token) {
        parser.addMissingToken("Expected opening string quote")
        return false
      }

      const str = token.getString()
      // TODO: always allow both types of quoting?
      if (str != '"' && str != "'") {

        // A variable can be found in place of a string
        // TODO: generalize this, maybe at the syntax definition level
        if (str[0] == "]") {
          if (!parser.syntax || parser.syntax == Syntax.MERLIN) {
            parser.addExpression(parser.parseVarExpression(token, false))
            return true
          }
        }

        token.setError("Expected quoted string argument")
        parser.addToken(token)
        return false
      }

      const allowUnterminated = false
      const expression = parser.parseStringExpression(token, parser.syntaxDef.stringEscapeChars, allowUnterminated)
      expression.name = this.termName
      parser.addExpression(expression)
      return true
    }

    // TODO: lots of cleanup needed here

    // *** <const-expression> type that must resolve in the first pass ***
    // *** <address-expression> type that does range check ***

    if (this.termType == "feature-name") {
      return this.addNameExpression(parser, "feature name", TokenType.Keyword)
    }
    if (this.termType == "seg-name") {
      return this.addNameExpression(parser, "segment name", TokenType.Keyword)
    }

    if (this.termType == "type-name") {
      return this.addSymbolExpression(parser, "type name", true, SymbolType.TypeName)
    }
    if (this.termType == "type-param") {
      return this.addSymbolExpression(parser, "named param", true, SymbolType.NamedParam)
    }
    if (this.termType == "define-name") {
      return this.addSymbolExpression(parser, "define name", true, SymbolType.TypeName)
    }
    if (this.termType == "define-param") {
      return this.addSymbolExpression(parser, "define param", true, SymbolType.NamedParam)
    }

    if (this.termType == "loop-var") {
      return this.addSymbolExpression(parser, "symbol name", true, SymbolType.Variable)
    }

    if (this.termType == "symbol") {
      return this.addSymbolExpression(parser, "symbol name", false, SymbolType.Simple)
    }
    if (this.termType == "symbol-def") {
      return this.addSymbolExpression(parser, "symbol name", true, SymbolType.Simple)
    }
    if (this.termType == "symbol-weakdef") {
      return this.addSymbolExpression(parser, "symbol name", true, SymbolType.Simple, true)
    }
    if (this.termType == "symbol-weakref") {
      return this.addSymbolExpression(parser, "symbol name", false, SymbolType.Simple, true)
    }

    // specific to ORCA/M
    if (this.termType == "condef") {
      return this.addCondefExpression(parser)
    }

    if (this.termType == "block") {
      parser.startExpression()
      while (true) {
        const token = parser.getNextToken()
        if (!token) {
          break
        }
        if (token.getString() == "}") {
          parser.ungetToken(token)
          break
        }
      }
      const expression = new exp.BadExpression(parser.endExpression())
      expression.name = this.termName
      parser.addExpression(expression)
      return true
    }

    const expression = parser.mustAddNextExpression()
    expression.name = this.termName
    return !(expression instanceof exp.BadExpression)
  }

  private addNameExpression(parser: Parser, typeName: string, tokenType: TokenType): boolean {

    const token = parser.mustGetNextToken("Expected " + typeName)
    if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      token.type = TokenType.Keyword
      const expression = new exp.Expression([token])
      expression.name = this.termName
      parser.addExpression(expression)
      return true
    }
    if (token.type != TokenType.Missing) {
      token.setError("Expected " + typeName)
    }
    parser.addExpression(new exp.BadExpression([token]))
    return false
  }

  private addSymbolExpression(parser: Parser, typeName: string, isDefinition: boolean, symbolType: SymbolType, isWeak = false): boolean {

    const token = parser.getNextToken()
    if (!token) {
      parser.addMissingToken("Expected " + typeName)
      return false
    }

    if (token.type == TokenType.Symbol || token.type == TokenType.HexNumber) {
      const expression = new exp.SymbolExpression([token], symbolType,
        isDefinition, parser.sourceFile, parser.lineNumber)
      expression.name = this.termName
      expression.isWeak = isWeak
      parser.addExpression(expression)
      return true
    }

    parser.addMissingToken("Expected " + typeName)
    return false
  }

  // specific to ORCA/M
  private addCondefExpression(parser: Parser): boolean {
    parser.startExpression()

    let token: Token | undefined
    token = parser.mustAddNextToken("Expecting DC type")
    if (token.type == TokenType.DecNumber) {
      // TODO: get repeat count
      token = parser.mustAddNextToken("Expecting DC type")
      // TODO: create number expression and give it a name
    }
    if (token.type == TokenType.Missing) {
      return false
    }

    let typeStr = token.getString()
    token.type = TokenType.Keyword

    token = parser.mustGetNextToken("Expecting '")
    if (token.type == TokenType.Missing) {
      return false
    }

    let parseExpressions = true
    if (typeStr == "c") {

      const allowUnterminated = false
      const expression = parser.parseStringExpression(token, parser.syntaxDef.stringEscapeChars, allowUnterminated)
      parser.addExpression(expression)
      parseExpressions = false

    } else {

      token.type = TokenType.Keyword
      parser.addToken(token)

      let size = 0
      switch (typeStr) {
        case "a":
          typeStr = "a2"
          // fall through
        case "a1":
        case "a2":
        case "a3":
        case "a4":
          size = typeStr.charCodeAt(1) - "0".charCodeAt(0)
          break
        case "d":
        case "e":
        case "f":
          // TODO: support floating point scientific notation
          break
        case "b":
        case "h":
          parseExpressions = false
          const valType = typeStr == "b" ? "binary" : "hex"

          token = parser.mustGetNextToken(`Expecting ${valType} value`)
          if (token.type == TokenType.Missing) {
            return false
          }

          let numString = ""
          while (true) {
            if (token.type != TokenType.DecNumber && token.type != TokenType.HexNumber) {
              token.setError(`Expecting ${valType} value`)
              return false
            }

            parser.addToken(token)
            numString += token.getString()

            token = parser.getNextToken()
            if (!token) {
              return false
            }
            if (token.getString() == "'") {
              token.type = TokenType.Keyword
              break
            }
          }
          if (valType == "hex") {
            if (numString.length & 1) {
              numString += "0"
            }
          } else {
            numString = numString.padEnd(16, "0")
          }
          break
        case "i":
          typeStr = "i2"
          // fall through
        case "i1":
        case "i2":
        case "i3":
        case "i4":
        case "i5":
        case "i6":
        case "i7":
        case "i8":
          size = typeStr.charCodeAt(1) - "0".charCodeAt(0)
          break
        case "r":
          break
        case "s1":
        case "s2":
        case "s3":
        case "s4":
          size = typeStr.charCodeAt(1) - "0".charCodeAt(0)
          break
        default:
          token.setError("Unexpected type")
          return false
      }
    }

    if (parseExpressions) {
      while (true) {
        const expression = parser.parseExpression()
        if (!expression) {
          return false
        }
        parser.addExpression(expression)
        const res = parser.mustAddToken([",", "'"])
        if (res.index < 0) {
          // *** set error?
          return false
        }
        if (res.index == 1) {
          if (res.token) {
            res.token.type = TokenType.Keyword
          }
          break
        }
      }
    }

    const expression = new exp.CondefExpression(parser.endExpression())
    expression.name = this.termName
    parser.addExpression(expression)
    return true
  }
}

//------------------------------------------------------------------------------

class OneOfParam extends Param {
  constructor(params: Param[]) {
    super(ParamType.OneOf, params)
  }

  parse(parser: Parser, parentName: string): boolean {
    // choose first successful parse of subParams
    this.savePosition(parser)
    for (let param of this.childParams!) {
      if (param.parse(parser, parentName)) {
        return true
      }
      this.restorePosition(parser)
    }

    let token = parser.getNextToken()
    let expression: exp.Expression | undefined
    if (token) {
      expression = parser.addNextExpression(token)
      if (expression) {
        expression.setError("Unexpected expression")
      }
    } else {
      token = parser.createMissingToken()
      token.setError("Missing expression")
      parser.addExpression(new exp.BadExpression([token]))
    }
    return false
  }
}

class OptionalParam extends Param {
  constructor(paramName: string | undefined, params: Param[], repeat: boolean) {
    super(ParamType.Optional, params, repeat)
  }

  parse(parser: Parser, parentName: string): boolean {
    this.savePosition(parser)
    if (this.childParams) {
      for (let param of this.childParams) {
        if (!param.parse(parser, parentName)) {
          this.restorePosition(parser)
          return true
        }
      }
      if (this.repeat) {
       this.parse(parser, parentName)
      }
    }

    // always return true because this is optional
    return true
  }
}

export class ParamsParser {

  // build expressions from ParamList

  public parseExpressions(paramList: ParamList, parser: Parser) {
    paramList.parse(parser, undefined)
  }

  // build Param object array from params definition string

  private str: string = ""
  private offset: number = 0

  public parseString(str: string, paramDefs?: Map<string, ParamDef>): ParamList {

    const saveStr = this.str
    const saveOffset = this.offset

    let params: Param[] = []
    this.str = str
    this.offset = 0
    const length = str.length
    while (this.offset < length) {
      params.push(this.parseParam(paramDefs))
    }
    const paramList = new ParamList(params)

    this.str = saveStr
    this.offset = saveOffset
    return paramList
  }

  private parseParam(paramDefs?: Map<string, ParamDef>): Param {
    while (true) {
      const char = this.str[this.offset++]
      if (char == " " || char == "\t") {
        continue
      }
      if (char === undefined) {
        throw "Param format error"
      }
      if (char == "<") {
        return this.parseTerm(paramDefs)
      } else if (char == "{") {
        return this.parseBraces()
      } else if (char == "[") {
        return this.parseOptional(paramDefs)
      } else {
        this.offset -= 1
        return this.parseConstant()
      }
    }
  }

  private parseTerm(paramDefs?: Map<string, ParamDef>): Param {
    let termName = ""
    let termType = ""

    while (true) {
      const char = this.str[this.offset++]
      if (char === undefined) {
        throw "Term param format error"
      }
      if (char == ">") {
        break
      }
      termName += char
    }

    const index = termName.indexOf(":")
    if (index >= 0) {
      termType = termName.substring(index + 1)
      termName = termName.substring(0, index)

      if (termType == "") {
        while (true) {
          const char = this.str[this.offset++]
          if (char == " " || char == "\t") {
            continue
          }
          if (char != "{") {
            break
          }

          return new TermParam(termName, "", [this.parseBraces(termName)] )
        }
      }
    } else {
      termType = termName
    }

    if (paramDefs) {
      const paramDef = paramDefs.get(termType)
      if (paramDef) {
        if (!paramDef.paramsList) {
          paramDef.paramsList = this.parseString(paramDef.params, paramDefs)
        }
        return new TermParam(termName, "", paramDef.paramsList.childParams )
      }
    }

    return new TermParam(termName, termType)
  }

  private parseBraces(paramName?: string): Param {
    let oneOfParams: Param[] = []
    let tempParams: Param[] = []
    while (true) {
      const char = this.str[this.offset++]
      if (char == " " || char == "\t") {
        continue
      }
      if (char === undefined) {
        throw "Brace param format error"
      }
      if (char == "}" || char == "|") {
        if (tempParams.length == 1) {
          oneOfParams.push(tempParams[0])
        } else {
          oneOfParams.push(new ParamList(tempParams))
        }
        tempParams = []
        if (char == "}") {
          break
        }
      } else {
        this.offset -= 1
        tempParams.push(this.parseParam())
      }
    }
    return new OneOfParam(oneOfParams)
  }

  private parseOptional(paramDefs?: Map<string, ParamDef>): Param {
    let params: Param[] = []
    let repeat = false
    while (true) {
      const char = this.str[this.offset++]
      if (char == " " || char == "\t") {
        continue
      }
      if (char === undefined) {
        throw "Optional param format error"
      }
      if (char == "]") {
        break
      }
      if (char == ".") {
        // for now, assume a single "." always starts "..."
        this.offset += 2
        repeat = true
        continue
      }
      this.offset -= 1
      params.push(this.parseParam(paramDefs))
    }

    return new OptionalParam("", params, repeat)
  }

  private parseConstant(): Param {
    let str = ""
    while (true) {
      let char = this.str[this.offset++]
      if (char === undefined) {
        this.offset -= 1
        break
      }
      if ("<{[|]}> \t".includes(char)) {
        this.offset -= 1
        break
      }
      // handle escaped character
      if (char == "\\") {
        char = this.str[this.offset++]
      }
      str += char
    }
    return new ConstantParam(str)
  }

  // build list of constant names for use by auto-completion

  public static getConstantNames(param: Param, paramDefs?: Map<string, ParamDef>): string[] {
    let names: string[] = []
    if (param.paramType == ParamType.Constant) {
      const contents = (param as ConstantParam).contents
      this.addConstantNames(names, [contents])
    } else if (param.paramType == ParamType.Term) {
      if (paramDefs) {
        const termType = (param as TermParam).termType
        const paramDef = paramDefs.get(termType)
        if (paramDef?.paramsList) {
          this.addConstantNames(names, ParamsParser.getConstantNames(paramDef.paramsList))
        }
      }
    } else {
      if (param.childParams) {
        for (let childParam of param.childParams) {
          this.addConstantNames(names, ParamsParser.getConstantNames(childParam))
        }
      }
    }
    return names
  }

  private static addConstantNames(names: string[], moreNames: string[]) {
    for (let name of moreNames) {
      if (name.length > 1 && !names.includes(name)) {
        names.push(name)
      }
    }
  }
}
