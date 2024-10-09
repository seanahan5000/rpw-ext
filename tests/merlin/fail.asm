                equ $1000               ; label required
                =   $2000               ; label required
                ext                     ; label required
                ent                     ; label required
                org -1000               ; org range error
                org $10000              ; org range error
                rel $0000               ; extra expression
                put                     ; filename required
                put filename,s6,d1,xx
dum_label       dum $1000               ; label not allowed
                dum                     ; expression required
                dend                    ; okay
                var
                ast
                cyc bad
                dat extra
                exp bad
                lst bad
                ttl
                tr bad
                asc "text",$8d
                da $10000
                dw -$8001
                ddb $10000
                dfb $100
                db $100
                db -129
                adr -1
                adr $1000000
                adrl $100000000
                hex 123
                hex $12
                hex 12 34
                ds
                do
                fin                     ; okay
                if
                err
                kbd
                xc bad
                mac                     ; label required
                pmc
                >>>
