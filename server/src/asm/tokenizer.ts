
import { Syntax } from "./syntax"

//------------------------------------------------------------------------------

export enum NodeErrorType {
  None,
  Error,
  Warning,
  Info
}

export type NodeRange = {
  sourceLine: string,
  start: number,
  end: number
}

export abstract class Node {
  public errorType: NodeErrorType
  public errorMessage?: string

  abstract getRange(): NodeRange | undefined
  abstract getString(): string

  constructor() {
    this.errorType = NodeErrorType.None
  }

  setError(message: string) {
    if (this.errorType != NodeErrorType.Error) {
      this.errorType = NodeErrorType.Error
      this.errorMessage = message
    }
  }

  setWarning(message: string) {
    if (this.errorType != NodeErrorType.Error &&
        this.errorType != NodeErrorType.Warning) {
      this.errorType = NodeErrorType.Warning
      this.errorMessage = message
    }
  }

  hasError(): boolean {
    return this.errorType == NodeErrorType.Error
  }
}

//------------------------------------------------------------------------------

export enum TokenType {
  Null,         // *** necessary?

  Operator,
  Symbol,
  HexNumber,
  DecNumber,

  String,
  Escape,
  Quote,

  Opcode,
  Keyword,
  Comment,

  Label,      // *** only used with locals?
  Macro,
  Variable,
  FileName,   // *** TODO: or just use quoted string?

  Missing
}

export class Token extends Node {
  public sourceLine: string
  public start: number
  public end: number
  public type: TokenType

  constructor(sourceLine: string, start: number, end: number, type: TokenType) {
    super()
    this.sourceLine = sourceLine
    this.start = start
    this.end = end
    this.type = type
  }

  getRange(): NodeRange {
    return { sourceLine: this.sourceLine, start: this.start, end: this.end }
  }

  getString(): string {
    return this.sourceLine.substring(this.start, this.end)
  }

  get length(): number {
    return this.end - this.start
  }

  isEmpty(): boolean {
    return this.start == this.end
  }
}

//------------------------------------------------------------------------------

export class Tokenizer {

  // when syntax is unknown, try to accomodate parsing every syntax
  public syntax = Syntax.UNKNOWN

  protected sourceLine: string = ""
  protected position: number = 0

  protected setSourceLine(sourceLine: string) {
    this.sourceLine = sourceLine
    this.position = 0
  }

  getPosition(): number {
    return this.position
  }

  setPosition(position: number) {
    this.position = position
  }

  getNextToken(): Token | undefined {
    let start = this.position
    this.skipWhitespace()
    let token = this.getVeryNextToken()
    if (!token) {
      // Back up to before skipWhitespace so that a subsequent missing token
      //  can be added at source of problem instead of at the next of the line.
      this.position = start
    }
    return token
  }

  peekNextToken(): Token | undefined {
    let mark = this.position
    let token = this.getNextToken()
    this.position = mark
    return token
  }

  mustGetNextToken(expectMsg: string): Token {
    // missing token should start before skipped whitespace
    let start = this.position
    this.skipWhitespace()
    let token = this.getVeryNextToken()
    if (!token) {
      token = new Token(this.sourceLine, start, start, TokenType.Missing)
      token.setError("Missing token, " + expectMsg)
    }
    return token
  }

  mustGetVeryNextToken(expectMsg: string): Token {
    let token = this.getVeryNextToken()
    if (!token) {
      token = new Token(this.sourceLine, this.position, this.position, TokenType.Missing)
      token.setError("Missing token, " + expectMsg)
    }
    return token
  }

  skipWhitespace() {
    while (this.position < this.sourceLine.length) {
      const c = this.sourceLine[this.position]
      if (c != " " && c != "\t") {
        break
      }
      this.position += 1
    }
  }

  // return next character, treating the start of a comment as end-of-line
  peekVeryNextChar(): string | undefined {
    if (this.position < this.sourceLine.length) {
      const nextChar = this.sourceLine[this.position]
      if (nextChar == ";") {
        if (this.position == 0) {
          return
        }
        const prevChar = this.sourceLine[this.position - 1]
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          if (prevChar == " " || prevChar == "\t") {
            return
          }
        } else {
          return
        }
      }
      return nextChar
    }
  }

  getVeryNextToken(): Token | undefined {
    let sawDigit = false
    let sawHex = false
    let sawSymbol = false
    let sawOperator = false
    let start = this.position

    while (this.position < this.sourceLine.length) {

      const char = this.sourceLine[this.position]
      const code = this.sourceLine.charCodeAt(this.position)

      // For tokenizing purposes, the start of a comment is treated as the
      //  end of the line.  Statement parsing will trim off the comment later.
      // TODO: check for C-style "/*" comment start?
      if (char == ";") {
        if (this.position == 0) {
          break
        }
        const prevChar = this.sourceLine[this.position - 1]
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          if (prevChar == " " || prevChar == "\t") {
            break
          }
        } else {
          break
        }
      }

      if (char == " " || char == "\t") {
        break
      }

      if (code >= 0x30 && code <= 0x39) {			// 0-9
        sawDigit = true
        this.position += 1
        continue
      }

      if ((code >= 0x41 && code <= 0x46) ||		// A-F
          (code >= 0x61 && code <= 0x66)) {		// a-f
        sawHex = true
        this.position += 1
        continue
      }

      if ((code >= 0x47 && code <= 0x5A) ||		// G-Z
          (code >= 0x67 && code <= 0x7A) ||		// g-z
           char == "_") {
        sawSymbol = true
        this.position += 1
        continue
      }

      // TODO: Merlin allows symbols to contain any character > ':'
      //	Specifically, "?" is used in some assembly code.
      if (char == "?") {
        if (!this.syntax || this.syntax == Syntax.MERLIN) {
          sawSymbol = true
          this.position += 1
          continue
        }
      }

      // several non-Merlin assemblers support '.' in symbols
      if (char == ".") {

        // DASM treats a stand-alone period as the PC counter
        if (this.syntax == Syntax.DASM) {
          if (this.position == start) {
            const nextChar = this.sourceLine[this.position + 1] ?? " "
            if (nextChar == " " || nextChar == "\t") {
              this.position += 1
              sawOperator = true
              break
            }
          }
        }

        // TODO: constrain this to the specific subset of assemblers
        if (!this.syntax || this.syntax != Syntax.MERLIN) {
          sawSymbol = true
          this.position += 1
          continue
        }
      }

      if (start == this.position) {
        sawOperator = true
        this.position += 1

        // collect repeats of same operator into single token
        const repeatIndex = "=&|:><+-".indexOf(char)
        if (repeatIndex != -1) {
          while (this.position < this.sourceLine.length) {
            if (this.sourceLine[this.position] != char) {
              break
            }
            this.position += 1
            // limit "=&|:" to doubles only
            if (repeatIndex < 4) {
              break
            }
          }
        }

        // combine some comparison operators (!=, >=, <=, <>, ><)
        if (this.position < this.sourceLine.length) {
          if (this.position - start == 1) {
            const nextChar = this.sourceLine[this.position]
            if (nextChar == "=") {
              if ("!><".indexOf(char) != -1) {
                this.position += 1
              }
            } else if (char == ">" && nextChar == "<") {
              this.position += 1
            } else if (char == "<" && nextChar == ">") {
              this.position += 1
            }
          }
        }
      }

      break
    }

    if (start != this.position) {
      // NOTE: A TokenType.Symbol here could still be a single letter reserved word (X, Y, W).
      //	A TokenType.HexNumber could still be a symbol or reserved word (BAD, A, B).
      //	A TokenType.DecNumber could still be a hex number.
      //	In all cases, it's up to the caller to choose between them.
      let type: TokenType
      if (sawSymbol) {
        type = TokenType.Symbol
      } else if (sawOperator) {
        type = TokenType.Operator
      } else if (sawHex) {
        type = TokenType.HexNumber
      } else if (sawDigit) {
        type = TokenType.DecNumber
      } else {
        type = TokenType.Null
      }
      return new Token(this.sourceLine, start, this.position, type)
    }
  }
}

//------------------------------------------------------------------------------
