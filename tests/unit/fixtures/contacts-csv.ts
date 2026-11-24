/**
 * Shared fixtures for the contacts CSV tests: a Google Contacts export (quoted
 * header cells, paired `E-mail N - Type`/`- Value` and `Phone N - Type`/`- Value`
 * columns) and a German Outlook export (semicolons, localised labels).
 */

export const GOOGLE_CSV = [
  '"Name","Given Name","Family Name","Birthday","Notes","E-mail 1 - Type","E-mail 1 - Value","E-mail 2 - Type","E-mail 2 - Value","Phone 1 - Type","Phone 1 - Value","Phone 2 - Type","Phone 2 - Value"',
  '"Maria Weber","Maria","Weber","1990-05-04","Likes tea","Home","maria@example.com","Work","maria.weber@work.example","Mobile","+49 170 1234567","Home","+49 30 123456"'
].join('\r\n')

export const OUTLOOK_DE_CSV = [
  'Vorname;Nachname;Primäre E-Mail-Adresse;Primäre Telefonnummer;Geburtstag',
  'Jürgen;Müller;j.mueller@example.de;+49 89 12345;04.05.1990'
].join('\r\n')
