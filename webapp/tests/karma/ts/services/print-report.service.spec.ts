import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import sinon from 'sinon';
import { expect } from 'chai';

import { PrintReportService } from '@mm-services/print-report.service';
import { TranslateService } from '@mm-services/translate.service';
import { DbService } from '@mm-services/db.service';
import { SettingsService } from '@mm-services/settings.service';
import { ReportViewModelGeneratorService } from '@mm-services/report-view-model-generator.service';

describe('PrintReportService', () => {
  let service: PrintReportService;
  let print: sinon.SinonStub;
  let query: sinon.SinonStub;
  let settings: sinon.SinonStub;
  let viewModel: sinon.SinonStub;
  let captured: { headings: string[]; rows: string[]; breaks: number } | undefined;

  const xmlReport = (form, reportedDate, fields) => ({
    form, reported_date: reportedDate, content_type: 'xml', fields,
  });

  beforeEach(() => {
    captured = undefined;
    print = sinon.stub(window, 'print').callsFake(() => {
      const view = document.getElementById('report-print-view') as HTMLElement;
      captured = {
        headings: Array.from(view.querySelectorAll('h1, h2, .printed-meta')).map(e => (e.textContent || '').trim()),
        rows: Array.from(view.querySelectorAll('.row, .section-head')).map(e => (e.textContent || '').trim()),
        breaks: view.querySelectorAll('.page-break').length,
      };
    });
    query = sinon.stub();
    settings = sinon.stub().resolves({ report_display: { ddst: {}, moca: {} } });
    viewModel = sinon.stub();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => (key === 'report.ddst.q1' ? 'Question 1' : key) },
        },
        { provide: DbService, useValue: { get: () => ({ query }) } },
        { provide: SettingsService, useValue: { get: settings } },
        { provide: ReportViewModelGeneratorService, useValue: { get: viewModel } },
      ],
    });
    service = TestBed.inject(PrintReportService);
  });

  afterEach(() => {
    sinon.restore();
    document.getElementById('report-print-view')?.remove();
  });

  it('prints one report with translated labels, scores and the participant name', fakeAsync(() => {
    const formatted = xmlReport('ddst', 1, [
      { label: 'report.ddst.group', depth: 0 },
      { label: 'report.ddst.q1', value: 'Pass', score: 1, depth: 1 },
      { label: 'report.ddst.q2', value: 'Fail', depth: 1 },
    ]);
    service.printSelection(
      { formatted, doc: { fields: { patient_name: 'Ravi Kumar', patient_id: 'NIMS-1' } } },
      'DDST-II',
    );
    tick(100);

    expect(print.calledOnce).to.be.true;
    expect(captured?.headings[0]).to.equal('DDST-II');
    expect(captured?.headings[1]).to.contain('Participant: Ravi Kumar (NIMS-1)');
    expect(captured?.rows).to.deep.equal([
      'report.ddst.group',
      'Question 1 — Score: 1: Pass',
      'report.ddst.q2: Fail',
    ]);
    tick(300);
    expect(document.getElementById('report-print-view')).to.equal(null);
  }));

  it('never shows the submitter as the participant', fakeAsync(() => {
    service.printSelection({ formatted: { ...xmlReport('ddst', 1, []), contact: { name: 'Screener' } }, doc: {} }, 'T');
    tick(100);
    expect(captured?.headings[1]).not.to.contain('Screener');
    tick(300);
  }));

  it('does nothing without a formatted report', () => {
    service.printSelection({}, 'T');
    expect(document.getElementById('report-print-view')).to.equal(null);
  });

  it('finds the subject ids of a report', () => {
    expect(service.subjectKeys({ patient_id: 'A', fields: { patient_uuid: 'U', patient_id: 'A', place_id: ' ' } }))
      .to.deep.equal(['U', 'A']);
    expect(service.subjectKeys(undefined)).to.deep.equal([]);
  });

  it('prints every scale report of the participant, oldest first, one per page', fakeAsync(async () => {
    query.resolves({ rows: [{ id: 'r2' }, { id: 'r1' }, { id: 'r3' }, { id: 'r1' }] });
    viewModel.withArgs('r1').resolves({
      formatted: xmlReport('ddst', 100, [{ label: 'report.ddst.q1', value: 'Pass' }]),
    });
    viewModel.withArgs('r2').resolves({
      formatted: xmlReport('moca', 50, [{ label: 'report.moca.total', value: '28' }]),
    });
    viewModel.withArgs('r3').resolves({ formatted: xmlReport('stage1', 10, []) });

    const printed = await service.printAllForSubject(
      { doc: { fields: { patient_uuid: 'part-1', patient_name: 'Ravi Kumar' } } },
      form => form.toUpperCase(),
    );
    tick(100);

    expect(printed).to.equal(2);
    expect(query.args[0]).to.deep.equal(['medic-client/reports_by_subject', { keys: ['part-1'] }]);
    expect(viewModel.callCount).to.equal(3);
    expect(captured?.headings.filter(h => h === 'MOCA' || h === 'DDST')).to.deep.equal(['MOCA', 'DDST']);
    expect(captured?.breaks).to.equal(1);
    tick(300);
  }));

  it('prints nothing when the report has no participant or no scale reports', async () => {
    expect(await service.printAllForSubject({ doc: {} }, f => f)).to.equal(0);
    query.resolves({ rows: [{ id: 'r3' }] });
    viewModel.resolves({ formatted: xmlReport('stage1', 10, []) });
    expect(await service.printAllForSubject({ doc: { fields: { patient_uuid: 'p' } } }, f => f)).to.equal(0);
    expect(print.notCalled).to.be.true;
  });
});
