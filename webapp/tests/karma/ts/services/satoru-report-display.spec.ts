import { TestBed } from '@angular/core/testing';
import sinon from 'sinon';
import { expect } from 'chai';

import { FormatDataRecordService } from '@mm-services/format-data-record.service';
import { SettingsService } from '@mm-services/settings.service';
import { FormatDateService } from '@mm-services/format-date.service';
import { LanguageService } from '@mm-services/language.service';
import { DbService } from '@mm-services/db.service';
import { TranslateLocaleService } from '@mm-services/translate-locale.service';

// Satoru: settings.report_display turns scale reports into readable rows
describe('FormatDataRecord service - Satoru report_display', () => {
  let settings;
  let formatDate;
  let service: FormatDataRecordService;

  const report = (fields) => ({ _id: 'r1', form: 'scale', content_type: 'xml', fields });
  const format = async (doc, cfg) => {
    settings.resolves({ report_display: { scale: cfg } });
    const formatted: any = await service.format(doc);
    return formatted.fields;
  };
  const row = (fields, label) => fields.find(f => f.label === `report.scale.${label}`);

  beforeEach(() => {
    settings = sinon.stub();
    formatDate = { relative: sinon.stub().returns('sometime'), date: sinon.stub().returns('29 Aug, 2026') };
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsService, useValue: { get: settings } },
        { provide: LanguageService, useValue: { get: sinon.stub().resolves('en') } },
        { provide: FormatDateService, useValue: formatDate },
        { provide: DbService, useValue: { get: () => ({ query: sinon.stub().resolves({ rows: [] }) }) } },
        { provide: TranslateLocaleService, useValue: { instant: sinon.stub().returnsArg(0) } },
      ]
    });
    service = TestBed.inject(FormatDataRecordService);
  });

  afterEach(() => sinon.restore());

  it('renders forms without a report_display entry exactly as stock CHT', async () => {
    settings.resolves({ report_display: { other: { hide_fields: ['a'] } } });
    const formatted: any = await service.format(report({ a: 'yes', b: '' }));
    expect(formatted.fields.map(f => [f.label, f.value])).to.deep.equal([
      ['report.scale.a', 'yes'],
      ['report.scale.b', ''],
    ]);
  });

  it('hides configured fields and whole groups', async () => {
    const fields = await format(report({ keep: 'x', calc: '1', group: { inner: '2' } }), {
      hide_fields: ['calc', 'group'],
    });
    expect(fields.map(f => f.label)).to.deep.equal(['report.scale.keep']);
  });

  it('resolves choice values and formats dates', async () => {
    const fields = await format(report({ item_1: 'P', item_2: 'Z', when: '2026-08-29' }), {
      choice_map: { item_1: { P: 'Pass' }, item_2: { P: 'Pass' } },
      date_fields: ['when'],
    });
    expect(row(fields, 'item_1').value).to.equal('Pass');
    expect(row(fields, 'item_2').value).to.equal('Z');
    expect(row(fields, 'when').value).to.equal('29 Aug, 2026');
  });

  it('keeps the raw date when formatting fails', async () => {
    formatDate.date.throws(new Error('bad date'));
    const fields = await format(report({ when: 'not-a-date' }), { date_fields: ['when'] });
    expect(row(fields, 'when').value).to.equal('not-a-date');
  });

  it('shows note text and attaches item scores', async () => {
    const doc = report({ disclaimer: '', item_1: 'yes', item_1_score: '1', item_2: 'no', item_2_score: '' });
    const fields = await format(doc, {
      note_values: { disclaimer: 'Screening only.' },
      score_fields: { item_1: 'item_1_score', item_2: 'item_2_score' },
    });
    expect(row(fields, 'disclaimer').value).to.equal('Screening only.');
    expect(row(fields, 'item_1').score).to.equal('1');
    expect(row(fields, 'item_2').score).to.be.undefined;
  });

  it('joins age parts into one readable row', async () => {
    const fields = await format(report({ age: '', years: '1', months: '2', dob: { days: '' } }), {
      join_fields: [
        { target: 'age', label: 'Chronological age', format: 'years_months_parts', parts: ['years', 'months'] },
      ],
    });
    const age = fields.find(f => f.label === 'Chronological age');
    expect(age.value).to.equal('1 year 2 months');
  });

  it('turns a number of days into years, months or days', async () => {
    const cfg = { join_fields: [{ target: 'age', format: 'days_to_years_months', parts: ['days'] }] };
    expect(row(await format(report({ age: '', days: '800' }), cfg), 'age').value).to.equal('2 years 2 months');
    expect(row(await format(report({ age: '', days: '400' }), cfg), 'age').value).to.equal('1 year 1 month');
    expect(row(await format(report({ age: '', days: '70' }), cfg), 'age').value).to.equal('2 months');
    expect(row(await format(report({ age: '', days: '10' }), cfg), 'age').value).to.equal('10 days');
    expect(row(await format(report({ age: 'x', days: '-1' }), cfg), 'age').value).to.equal('x');
  });

  it('suppresses empty rows unless they must be kept', async () => {
    const fields = await format(report({ empty: '', kept: '', full: 'y' }), {
      suppress_empty: true,
      keep_empty: ['kept'],
    });
    expect(fields.map(f => f.label)).to.deep.equal(['report.scale.kept', 'report.scale.full']);
  });
});
