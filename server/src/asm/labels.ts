
import { Token, TokenErrorType, TokenType } from "./tokenizer";
import { Statement } from "./x_statements"

type LabelInfo = {
  line: number,
  token: Token,
  label: string,
  link?: LabelInfo,
  newName?: string
}

export type LineEdit = {
  line: number,
  start: number,
  end: number,
  text: string
}

export class LabelScanner {

  private defList: LabelInfo[] = []
  private useList: LabelInfo[] = []

  scanStatements(statements: Statement[]) {
    let startLine = -1
    let endLine = 0
    while (endLine < statements.length) {
      startLine = endLine
      //*** TODO: also support DASM subroutine scoping ***
      while (++endLine < statements.length) {
        const statement = statements[endLine]
        const tokens = statement.getTokens()
        if (tokens.length > 0) {
          if (tokens[0].type == TokenType.Label) {
            break
          }
        }
      }
      this.scanRange(statements, startLine, endLine)
      this.markLocals()
    }
  }

  renumberLocals(statements: Statement[], startLine: number, endLine: number): LineEdit[] | undefined {
    // expand out selection
    // TODO: what about DASM subroutine?
    while (startLine > 0) {
      const statement = statements[startLine]
      const tokens = statement.getTokens()
      if (tokens.length > 0) {
        if (tokens[0].type == TokenType.Label) {
          break
        }
      }
      startLine -= 1
    }
    while (endLine < statements.length) {
      const statement = statements[endLine]
      const tokens = statement.getTokens()
      if (tokens.length > 0) {
        if (tokens[0].type == TokenType.Label) {
          break
        }
      }
      endLine += 1
    }

    // walk each valid range
    // rename locals in range

    //this.scanRange(statements, startLine, endLine)
    return this.renumberRange(statements, startLine, endLine)
  }

  renumberRange(statements: Statement[], startLine: number, endLine: number): LineEdit[] | undefined {
    this.scanRange(statements, startLine, endLine)

    // build renumbered names for definitions
    let sawError = false
    let newIndex = 1
    for (let i = 0; i < this.defList.length; i += 1) {
      let defInfo = this.defList[i]
      defInfo.newName = defInfo.label

      if (defInfo.label.length < 2) {
        continue
      }

      // don't renumber complex locals
      if (!this.isSimpleLocal(defInfo)) {
        continue
      }

      // abort renumber if any labels have errors
      if (defInfo.token.errorType == TokenErrorType.Error) {
        sawError = true
        break
      }

      // remove unused locals
      if (defInfo.token.errorType == TokenErrorType.Warning) {
        //*** TODO: check that warning really is unused
        defInfo.newName = "".padEnd(defInfo.label.length, " ")
        continue
      }

      defInfo.newName = defInfo.label[0] + newIndex.toString()
      newIndex += 1
    }

    for (let i = 0; i < this.useList.length; i += 1) {
      let useInfo = this.useList[i]
      if (useInfo.token.errorType == TokenErrorType.Error) {
        sawError = true
        break
      }
    }

    if (sawError) {
      return
    }

    // rename all local label definitions then references
    let edits: LineEdit[] = []
    this.processInfo(this.defList, statements, edits, true)
    this.processInfo(this.useList, statements, edits, false)
    return edits
  }

  private processInfo(infoList: LabelInfo[], statements: Statement[], edits: LineEdit[], isDefs: boolean) {
    for (let i = 0; i < infoList.length; i += 1) {
      let info = infoList[i]
      let edit = {
        line: info.line,
        start: info.token.start,
        end: info.token.end,
        text: (isDefs ? info.newName : info.link?.newName) || ""
      }
      if (edit.text == info.label) {
        continue
      }
      let sizeDelta = edit.text.length - info.label.length
      if (sizeDelta != 0) {
        if (sizeDelta > 0) {
          // if next character is a space rather than a tab, grow over it
          if (statements[info.line].sourceLine[info.token.end] == " ") {
            edit.end += 1
          }
        } else {
          // pad new name to cover over old larger name
          edit.text = edit.text.padEnd(info.label.length, " ")
        }
      }
      edits.push(edit)
    }
  }

  // Return true if local is a simple number or if it's of the form
  //  :SKIPA and :LOOP1 (common in old Naja source code)
  isSimpleLocal(info: LabelInfo): boolean {
    let index = parseInt(info.label.substring(1))
    if (index != index) {
      if (info.label.length != 6) {
        return false
      }
      let root = info.label.substring(1, 5)
      if (root != "SKIP" && root != "LOOP") {
        return false
      }
    }
    return true
  }

  private scanRange(statements: Statement[], startLine: number, endLine: number) {
    this.defList = []
    this.useList = []

    // build list of local label definitions and used of those labels
    for (let i = startLine; i < endLine; i += 1) {
      const statement = statements[i]
      const tokens = statement.getTokens()
      for (let j = 0; j < tokens.length; j += 1) {
        const token = tokens[j]
        if (token.type == TokenType.LocalLabel) {
          let str = token.getString()
          let info = { line: i, token: token, label: str }
          if (j == 0) {
            this.defList.push(info)
          } else {
            this.useList.push(info)
          }
        }
      }
    }

    // walk all used local labels and link to their definition
    for (let i = 0; i < this.useList.length; i += 1) {
      const info = this.useList[i]
      for (let j = 0; j < this.defList.length; j += 1) {
        if (this.defList[j].label == info.label) {
          info.link = this.defList[j]
          if (!this.defList[j].link) {
            this.defList[j].link = info
          }
          break
        }
      }
    }
  }

  private markLocals() {
    // mark any label whose definitions was not found
    for (let i = 0; i < this.useList.length; i += 1) {
      const info = this.useList[i]
      // mark any label whose definitions was not found
      if (!info.link) {
        info.token.setError("Label not found")
      }
    }

    // walk all definitions and mark those that are unused
    for (let i = 0; i < this.defList.length; i += 1) {
      const info = this.defList[i]
      if (!info.link) {
        // don't report complex locals as unused
        if (!this.isSimpleLocal(info)) {
          continue
        }
        info.token.setWarning("Label not referenced")
      }
    }

    // walk all defintions and mark any duplicates
    for (let i = 0; i < this.defList.length; i += 1) {
      for (let j = i + 1; j < this.defList.length; j += 1) {
        if (this.defList[i].label == this.defList[j].label) {
          this.defList[i].token.setError("Duplicate label")
          this.defList[j].token.setError("Duplicate label")
        }
      }
    }
  }
}
