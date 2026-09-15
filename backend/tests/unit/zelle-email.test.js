'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  Bank of America's Zelle alert is the only signal a Zelle payment arrived.
//  These fixtures copy the real alert's shape (names changed): subject
//  "<payer> sent you $<amount>", an optional memo line, no confirmation number.
//  Only a DKIM-verified bankofamerica.com message may become a payment.
// ─────────────────────────────────────────────────────────────────────────────

const { parseZelleEmail, bankSigned, localDate, namesMatch, sameName } = require('../../src/modules/payments/zelle.recorder')

const SIGNED = 'fr-int-smtpin30.hostinger.io; dkim=pass header.d=ealerts.bankofamerica.com header.s=200608 header.b=HQBcCpDR;\r\n dkim=pass header.d=s5.y.mc.salesforce.com header.s=fbldkim5; dmarc=pass (policy=reject) header.from=bankofamerica.com'

const alert = (over = {}) => ({
  subject: 'Jane Q Sample sent you $88.00',
  from: '"Bank of America" <customerservice@ealerts.bankofamerica.com>',
  date: 'Fri, 11 Sep 2026 16:53:37 -0600',
  message_id: '<212176bd-fc15-465b-b31f-9b8f321d7d5f@las1s05mta0013.xt.local>',
  authentication_results: SIGNED,
  text: '\n Jane Q Sample sent you $88.00\n DTG T-Shirts\n View your balance \n Please allow up to 5 minutes for the\n money to deposit to your account.\n',
  ...over,
})

describe('a real incoming alert', () => {
  test('reads payer, amount, memo and the bank-local date', () => {
    expect(parseZelleEmail(alert())).toEqual({
      ok: true, payer: 'Jane Q Sample', amount: 88, memo: 'DTG T-Shirts', payment_date: '2026-09-11',
      message_id: '212176bd-fc15-465b-b31f-9b8f321d7d5f@las1s05mta0013.xt.local',
      sender: 'customerservice@ealerts.bankofamerica.com',
    })
  })

  test('an alert with no memo has memo null, and thousands parse', () => {
    const r = parseZelleEmail(alert({
      subject: 'Sam Payer sent you $1,250.50',
      text: ' Sam Payer sent you $1,250.50\n View your balance \n Please allow up to 5 minutes',
    }))
    expect(r).toMatchObject({ ok: true, payer: 'Sam Payer', amount: 1250.5, memo: null })
  })

  test('HTML-only bodies are read too', () => {
    const r = parseZelleEmail(alert({ text: '', html: '<td>Jane Q Sample sent you $88.00</td><td>Hats</td><td>View your balance</td>' }))
    expect(r).toMatchObject({ ok: true, memo: 'Hats' })
  })

  test('the date is the day in the header offset, not UTC', () => {
    expect(localDate('Mon, 31 Aug 2026 19:12:52 -0600')).toBe('2026-08-31')   // 01:12 UTC on Sep 1
  })
})

describe('anything that is not the bank is refused', () => {
  test('a look-alike sender', () => {
    const r = parseZelleEmail(alert({ from: 'Bank of America <alerts@bankofamerica.com.evil.io>' }))
    expect(r.ok).toBe(false)
  })

  test('the right From but no bank DKIM pass', () => {
    expect(parseZelleEmail(alert({ authentication_results: 'fr-int-smtpin30.hostinger.io; dkim=fail header.d=ealerts.bankofamerica.com' })).ok).toBe(false)
    expect(parseZelleEmail(alert({ authentication_results: '' })).ok).toBe(false)
  })

  test('a pass stamped by some other server is not trusted', () => {
    expect(bankSigned('mx.attacker.example; dkim=pass header.d=ealerts.bankofamerica.com')).toBe(false)
  })

  test('a customer forwarding "I sent you $80 on Zelle" is refused', () => {
    const r = parseZelleEmail(alert({ from: 'Customer <buyer@gmail.com>', authentication_results: 'fr-int-smtpin1.hostinger.io; dkim=pass header.d=gmail.com' }))
    expect(r.ok).toBe(false)
  })
})

describe('bank emails that are not money in', () => {
  test('an outgoing Zelle is ignored, not rejected', () => {
    const r = parseZelleEmail(alert({
      subject: 'Zelle® payment of $600.00 to DIGIPRINT AMERICA INC has been sent',
      text: ' Zelle® payment of $600.00 to DIGIPRINT AMERICA INC has been sent\n Sent from account\n ending in 0603\n Confirmation\n n9z6o9ktd',
    }))
    expect(r).toMatchObject({ ok: false, ignorable: true })
  })

  test('a recipient-added notice is ignored', () => {
    const r = parseZelleEmail(alert({ subject: "You've added Blanca Mosqueda as a Zelle recipient", text: "You've added Blanca Mosqueda as a Zelle recipient" }))
    expect(r).toMatchObject({ ok: false, ignorable: true })
  })
})

describe('matching a payer to what staff typed', () => {
  test.each([
    ['Timothy K Cheung', 'Timothy K Cheung', true],
    ['Samuel Ngwamukie', 'Ngwamukie Samuel', true],
    ['Teddy Ray Wilson Jr', 'Teddy Ray Wilson', true],
    ['Alhelí AR', 'Alheli AR', true],
    ['Ricardo Malia', 'Ricardo', false],
    ['Timothy K Cheung', 'Tim BlackDragon', false],
    ['Teddy Ray Wilson Jr', '88.00', false],
  ])('%s ~ %s → %s', (a, b, want) => expect(namesMatch(a, b)).toBe(want))

  test('linking a customer needs the very same name', () => {
    expect(sameName('Ricardo Malia', 'Malia Ricardo')).toBe(true)
    expect(sameName('Ricardo Malia', 'Ricardo Malia Jr')).toBe(true)
    expect(sameName('Ricardo Malia', 'Ricardo A Malia Santos')).toBe(false)
  })
})
