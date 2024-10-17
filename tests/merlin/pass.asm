BUILD           =   1

symbol1         equ $1000
symbol2         =   $2000
value           =   #99

my_ext          ext
my_ent          ent

                org $1000
                org
                rel
    do BUILD-1
                obj $4000
    fin

label
                put pass.inc
                put ./pass.inc
                use pass.inc
    do BUILD-1
                put pass.inc,d2
                use pass.inc,s6,d1
    fin
                sav filename.obj
                typ $00
                dsk filename.obj

                dum $00
                dend
                dum *
                dend

                var 1;$3;label

                ast 30
                cyc
                cyc off
                cyc avg
                cyc flags
                dat
                exp on
                exp off
                exp only

                lst on
                lst off
                lst
                lst rtn
                lstdo
                lstdo off
                pag
                ttl "title"
                skp 1
                tr on
                tr off
                tr adr

                asc "string"
                asc "string",8D
                dci 'string'
                dci 'string',878D
                inv "test"
                fls "test"
                rev "test"
                str "test"

                da $fdf0
                dw label
                db #<label
                ddb label,$300
                dfb $00
                dfb #$00
                db $ff
                db #$ff
                adr label
                adrl label
                hex 01020304
                hex 01,02,03,04

                ds  $10
                ds  \
                ds  \,$00

                do 1
                else
                fin

                ; if (,]1
                ; fin

                chk
                err 1
kbd_label1      kbd
kbd_label2      kbd "text"

                lup 4
                --^

                pau
                sw
                usr ()

                xc

my_mac1         mac
                eom
my_mac2         mac
                <<<
                pmc my_mac1
                >>> my_mac2
                my_mac1

                brk
                brk $00                 ; optional argument
                brk #$00                ; optional argument

; *** colorizing problems after text escapes
                asc "\\"
                asc "\""
                asc '"'
                asc "'"
                asc "\'"
                asc "\r"
                asc "\n"
                asc "\t"
                asc "\x1F"

    do BUILD-1
                txc "TEXT\n"
                txt "TEXT"
                txi "TEXT"
    fin

                ; left-to-right precedence
LOAD_BASE       =   $8000
precedence      =   $800-$800+LOAD_BASE ;*** why no hover over LOAD_BASE, precedence?
                do precedence-LOAD_BASE
                error
                fin

                ; ">" precedence lower than rest of expression
                LDA #>LOAD_BASE+$0100

                end
