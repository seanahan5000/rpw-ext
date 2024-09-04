

// OneOf
  // expression array

// Optional

class Param {
  // ***

  // *** parse string on Statement ***
}

class TermParam extends Param {
  private name: string

  constructor(name: string) {
    super()
    this.name = name
  }
}

class OneOfParam extends Param {
  private params: Param[] = []

  constructor(params: Param[]) {
    super()
    this.params = params
  }
}

class OptionalParam extends Param {
  private params: Param[] = []
  private repeat: boolean = false

  constructor(params: Param[], repeat: boolean) {
    super()
    this.params = params
    this.repeat = repeat
  }
}

class ConstantParam extends Param {
  private contents: string

  constructor(contents: string) {
    super()
    this.contents = contents
  }
}

export class ParamParser {

  private params: Param[] = []
  private str: string = ""
  private offset: number = 0

  // *** for testing ***
  constructor() {
    // this.parse('{"6502"|"65c02"|"65816"|"default"}')
    // this.parse("<expression>")
    this.parse("<expression>[, <expression> ...]")
// params: "<length>[, <fill>]",
// params: "[<name>][=<default>]][, [<name>][=<default>] ...]",
  }

  public parse(str: string) {
    this.str = str
    this.offset = 0
    const length = str.length
    while (this.offset < length) {
      this.params.push(this.parseParam())
    }
  }

  private parseParam(): Param {
    const char = this.str[this.offset++]
    if (char == "<") {
      return this.parseTerm()
    } else if (char == "{") {
      return this.parseBraces()
    } else if (char == "[") {
      return this.parseOptional()
    } else {
      this.offset -= 1
      return this.parseConstant()
    }
  }

  private parseTerm(): Param {
    let term = ""
    while (true) {
      const char = this.str[this.offset++]
      if (char == ">") {
        break
      }
      term += char
    }
    return new TermParam(term)
  }

  private parseBraces(): Param {
    let params: Param[] = []
    while (true) {
      const char = this.str[this.offset]
      if (char == "}") {
        this.offset += 1
        break
      }
      if (char == "|") {
        this.offset += 1
        continue
      }
      params.push(this.parseParam())
    }
    return new OneOfParam(params)
  }

  private parseOptional(): Param {
    let params: Param[] = []
    while (true) {
      const char = this.str[this.offset]
      if (char == "]") {
        this.offset += 1
        break
      }
      params.push(this.parseParam())
    }

    const repeat = false  // ***
    return new OptionalParam(params, repeat)
  }

  private parseConstant(): Param {
    let str = ""
    while (true) {
      const char = this.str[this.offset++]
      if ("<{[|]}>".includes(char)) {
        this.offset -= 1
        break
      }
      str += char
    }
    return new ConstantParam(str)
  }
}


// params: '{"6502"|"65c02"|"65816"|"default"}',
// params: "<expression>[, <expression> ...]",
// params: "<length>[, <fill>]",
// params: "[<name>][=<default>]][, [<name>][=<default>] ...]",

// const parser = new ParamParser()
// parser.parse('{"6502"|"65c02"|"65816"|"default"}')
