# Word substitutions — avoid → prefer

A lookup table, not a document to read end to end. When you simplify vocabulary,
prefer the right-hand form in comments, docs, commit messages, and error strings.

Rules of use:

- These are defaults, not absolutes. If a right-hand swap breaks the sentence,
  restructure the whole sentence instead (STE rule 9.1).
- Keep any term that is a fixed external API field, config key, or quoted error
  string exactly as-is, even if it appears on the left.
- Domain nouns are exempt ("foreign key" stays; "foreign object" → "unwanted
  material").

---

## Verb inflation → plain verb

    utilize / employ / adopt ........ use
    commence ........................ start / begin
    terminate / halt / quit ......... stop
    perform / accomplish / conduct /
      carry out / execute ........... do   (or a specific verb: run, measure, build)
    implement ....................... do / build
    facilitate ...................... help / make easier
    assist / aid .................... help
    endeavour / attempt ............. try
    obtain / acquire / attain /
      achieve / procure ............. get
    ascertain / verify / ensure /
      confirm / establish ........... make sure
    locate / trace / discover /
      detect / determine / diagnose . find
    modify / alter / amend / vary /
      convert / transition .......... change
    notify / inform ................. tell
    indicate / evidence ............. show
    maintain ........................ keep
    monitor / track ................. check (over time) / watch
    eliminate / purge / extract ..... remove
    purify .......................... clean
    govern / regulate ............... control / adjust
    reference (v) ................... refer to
    execute a script ................ run a script

## Latinate / formal connective → plain

    prior to / precede .............. before
    subsequent to ................... after / next
    in order to ..................... to
    in the event of / in case of ... if
    provided that ................... if
    whether ......................... if
    unless .......................... except if
    otherwise ....................... if ... not   (restructure)
    due to .......................... because of / because
    regarding / concerning / as to .. about
    per ............................. for each
    via ............................. through / by
    with the exception of / except .. (restate both cases explicitly)
    however ......................... but
    therefore / thus ................ as a result   (or split the sentence)
    such as ......................... for example
    respectively .................... (name each item explicitly)
    whilst .......................... while

## Vague qualifier → concrete / testable

    adequate / sufficient ........... enough   (give a number if possible)
    considerable / big / huge ....... large    (give the value if possible)
    significant / serious ........... important / dangerous
    various ......................... different
    potential / probable ............ possible
    probability ..................... risk
    exceed / excessive / over ....... more than N
    extreme(ly) ..................... very (+ specific adjective)
    eventually ...................... after some time
    periodically / prompt(ly) ....... immediately / after N seconds (state the interval)
    approximately / circa ........... approximately (give a range)
    poor / questionable ............. unsatisfactory / not sure
    faulty / flaw ................... defective / incorrect / damage
    glitch .......................... error / failure
    handle (v) ...................... the actual action: parse / route / validate / reject / move
    generate / produce .............. cause / give / make / supply (say what causes what)
    trigger (v) ..................... cause / start

## Prefer "not X" over a fused negative (when the fused word is not itself a term)

    impossible ...................... not possible / cannot
    incompatible .................... not compatible
    incomplete ...................... not full / not completed
    insufficient .................... not enough
    unable .......................... cannot
    unstable / undamaged ............ not stable / not damaged
    unauthorized .................... not approved
    unnecessary ..................... not necessary

## De-prefix the "re-" reflex (base verb + "again")

    readjust / recheck / reinstall /
      refill / recharge / rebuild ... adjust again / check again / ...
    (keep "rebuild" / "retry" only where they are fixed technical terms)

## Modal discipline

    shall / should / would .......... must   (obligation) — or "can" / "if" when
                                      it is really possibility
    could (for possibility) ......... can

## Miscellaneous high-value

    additional / extra / further .... more
    final ........................... last
    finish .......................... complete
    primarily / principal /
      main / major .................. primary   (one word per concept)
    proceed / progress .............. continue
    reduce .......................... decrease   (increase for accelerate/augment)
    technique ....................... method
    process (n) ..................... procedure  (reserve "process" for the real
                                      technical sense, e.g. an OS process)

---

## The patterns behind the list

1. Prefer the short, common word over the long Latinate synonym.
2. Collapse each near-synonym cluster to ONE term and use it everywhere.
3. Cash out vague words into a value, a bound, or an explicit `if`.
4. Split ambiguous multi-sense verbs by literal meaning (not "handle the
   request" — say what happens to it).
5. Prefer "not X" to a fused negative word, unless the fused form is a real term.
6. Turn nominalizations back into verbs.
7. Delete filler rather than translate it ("in order to", "already").
8. Ban "except/exception" phrasing in specs — state both branches plainly.
9. Be precise about time/order: "then"/"next" (immediate) vs "subsequent"/"later"
   (vague).
10. Modals collapse to two strengths: MUST (obligation) and CAN (possibility).
