import { Injectable, Injector } from '@angular/core';

import { TranslateService } from '@mm-services/translate.service';
import { DbService } from '@mm-services/db.service';
import { SettingsService } from '@mm-services/settings.service';
import { ReportViewModelGeneratorService } from '@mm-services/report-view-model-generator.service';

/**
 * Print/Save-as-PDF for the Reports view.
 *
 * Renders the SAME formatted, human-readable field rows the report detail
 * UI displays (selection.formatted.fields, already produced by
 * FormatDataRecordService with the scale-report config applied) into a
 * dedicated print container and triggers the browser's print dialog
 * (Save as PDF). No separate data representation: the printout always
 * matches what the user sees.
 *
 * printAllForSubject prints every scale report about the same participant
 * (oldest first, one per page) through the same rendering.
 */
@Injectable({ providedIn: 'root' })
export class PrintReportService {

  constructor(
    private readonly translateService: TranslateService,
    // print-all services are resolved on first use, not when the reports page loads
    private readonly injector: Injector,
  ) {
  }

  printSelection(selection: any, title: string): void {
    const doc = selection?.formatted;
    if (!doc) {
      return;
    }

    const printContainer = this.ensureContainer();
    printContainer.innerHTML = '';
    printContainer.appendChild(this.buildStyles());
    printContainer.appendChild(this.buildHeader(doc, selection.doc, title));
    printContainer.appendChild(this.buildReport(doc));
    this.print(printContainer);
  }

  /** ids the report is filed under in medic-client/reports_by_subject */
  subjectKeys(report: any): string[] {
    const fields = report?.fields || {};
    const keys = [fields.patient_uuid, fields.patient_id, report?.patient_id, fields.place_id]
      .filter(key => typeof key === 'string' && key.trim());
    return [...new Set(keys)] as string[];
  }

  async printAllForSubject(selection: any, titleFor: (form: string) => string): Promise<number> {
    const current = selection?.doc;
    const keys = this.subjectKeys(current);
    if (!keys.length) {
      return 0;
    }

    const dbService = this.injector.get(DbService);
    const settingsService = this.injector.get(SettingsService);
    const reportViewModelGeneratorService = this.injector.get(ReportViewModelGeneratorService);
    const [result, settings] = await Promise.all([
      dbService.get().query('medic-client/reports_by_subject', { keys }),
      settingsService.get(),
    ]);
    const ids = [...new Set(result.rows.map(row => row.id))];
    const models = await Promise.all(ids.map(id => reportViewModelGeneratorService.get(id)));

    // only the scales that have a report layout, when any are configured
    const scaleForms = settings?.report_display ? Object.keys(settings.report_display) : null;
    const reports = models
      .filter(model => model?.formatted?.form && (!scaleForms || scaleForms.includes(model.formatted.form)))
      .sort((a, b) => (a.formatted.reported_date || 0) - (b.formatted.reported_date || 0));

    if (!reports.length) {
      return 0;
    }

    const printContainer = this.ensureContainer();
    printContainer.innerHTML = '';
    printContainer.appendChild(this.buildStyles());
    const heading = document.createElement('div');
    heading.innerHTML = `
      <h1>All scales</h1>
      <div class="printed-meta">
        Participant: ${this.escape(this.subjectName(reports[0].formatted, current) || keys[0])} &nbsp;
        ${reports.length} report(s) &nbsp; Printed: ${new Date().toLocaleString()}
      </div>
    `;
    printContainer.appendChild(heading);

    reports.forEach(({ formatted: doc }, index) => {
      const section = document.createElement('div');
      section.className = index ? 'report-section page-break' : 'report-section';
      const title = document.createElement('h2');
      title.textContent = titleFor(doc.form);
      section.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'printed-meta';
      meta.textContent = doc.reported_date ? `Submitted: ${new Date(doc.reported_date).toLocaleString()}` : '';
      section.appendChild(meta);
      section.appendChild(this.buildReport(doc));
      printContainer.appendChild(section);
    });

    this.print(printContainer);
    return reports.length;
  }

  private buildReport(doc: any): HTMLElement {
    const rows = this.collectRows(doc);
    // xml reports carry translation keys as labels - same rule the
    // reports-content template uses ({{field.label | translate}})
    return this.buildRows(rows, doc.content_type === 'xml', doc._id);
  }

  private print(printContainer: HTMLElement) {
    // wait for layout, print, then remove the container
    setTimeout(() => {
      window.print();
      setTimeout(() => printContainer.remove(), 300);
    }, 100);
  }

  // the participant, never doc.contact (that is whoever submitted the report).
  // rawDoc is the unformatted report: formatting turns fields into display rows
  private subjectName(doc: any, rawDoc: any): string {
    const fields = rawDoc?.fields || {};
    const name = fields.patient_name || doc.patient?.name;
    const id = fields.patient_id || rawDoc?.patient_id;
    if (name && id) {
      return `${name} (${id})`;
    }
    return name || id || doc.subject?.value || '';
  }

  private ensureContainer(): HTMLElement {
    let el = document.getElementById('report-print-view');
    if (!el) {
      el = document.createElement('div');
      el.id = 'report-print-view';
      document.body.appendChild(el);
    }
    return el;
  }

  private buildStyles(): HTMLElement {
    const style = document.createElement('style');
    style.textContent = `
      @media print {
        body > app-root { display: none !important; }
        #report-print-view { display: block !important; }
      }
      #report-print-view {
        display: none;
        font-family: 'Noto Sans', 'Open Sans', Arial, sans-serif;
        color: #1a1a1a;
        margin: 1cm;
      }
      #report-print-view h1 { font-size: 16pt; margin: 0 0 4px; }
      #report-print-view h2 { font-size: 14pt; margin: 0 0 4px; }
      #report-print-view .page-break { page-break-before: always; break-before: page; }
      #report-print-view .printed-meta { color: #555; font-size: 9pt; margin-bottom: 12px; }
      #report-print-view .section-head {
        font-size: 11pt; font-weight: 600; margin: 14px 0 4px;
        border-bottom: 1px solid #999; padding-bottom: 2px;
      }
      #report-print-view .row { margin: 2px 0; page-break-inside: avoid; }
      #report-print-view .row .label { font-weight: 600; }
      #report-print-view .row .value { margin-left: 8px; }
      #report-print-view .row.depth-0 { margin-top: 6px; }
      #report-print-view .score-badge { font-weight: 600; }
      #report-print-view .print-attachment-img {
        display: block;
        max-width: 100%;
        max-height: 480px;
        margin: 8px 0;
        border: 1px solid #ccc;
        border-radius: 4px;
        page-break-inside: avoid;
      }
      #report-print-view .print-pdf-badge {
        margin: 6px 0;
        padding: 6px 10px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        font-size: 10pt;
      }
    `;
    return style;
  }

  private escape(text: any): string {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private buildHeader(doc: any, rawDoc: any, title: string): HTMLElement {
    const header = document.createElement('div');
    const subject = this.subjectName(doc, rawDoc);
    header.innerHTML = `
      <h1>${this.escape(title)}</h1>
      <div class="printed-meta">
        ${subject ? `Participant: ${this.escape(subject)} &nbsp; ` : ''}
        Printed: ${new Date().toLocaleString()}
      </div>
    `;
    return header;
  }

  private collectRows(doc: any): any[] {
    const rows: any[] = [];
    const walk = (fields: any[]) => fields?.forEach((f) => {
      rows.push(f);
      if (f.isArray && Array.isArray(f.data)) {
        walk(f.data);
      }
    });
    if (doc.content_type !== 'xml' && doc.fields?.data) {
      walk(doc.fields.data);
    } else {
      walk(doc.fields);
    }
    return rows;
  }

  private label(field: any, translateLabels: boolean): string {
    const key = field.translationKey || field.label || '';
    if (!translateLabels || !key) {
      return field.label || '';
    }
    const translated = this.translateService.instant(key);
    if (translated && translated !== key) {
      return translated;
    }
    // Clean human fallback if unmapped so raw codes never leak
    const raw = key.startsWith('report.') ? key.split('.').slice(2).join('.') : key;
    const segs = raw.split('.').filter(p => !/^\d+$/.test(p));
    const leaf = segs[segs.length - 1] || raw;
    return leaf
      .replace(/^g_|^grp_|^calc_|^mb_|^m8_|^te_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  private buildRows(rows: any[], translateLabels: boolean, docId?: string): HTMLElement {
    const wrap = document.createElement('div');
    rows.forEach((field) => {
      if (field.value === undefined && !field.isArray) {
        // group header row
        const head = document.createElement('div');
        head.className = `section-head depth-${field.depth || 0}`;
        head.textContent = this.label(field, translateLabels);
        wrap.appendChild(head);
        return;
      }
      const row = document.createElement('div');
      row.className = `row depth-${field.depth || 0}`;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = this.label(field, translateLabels);
      row.appendChild(label);
      if (field.score !== undefined) {
        const score = document.createElement('span');
        score.className = 'score-badge';
        score.textContent = ` — Score: ${field.score}`;
        row.appendChild(score);
      }
      if (field.attachmentInfo?.isImage || field.imagePath) {
        const attName = field.attachmentInfo?.name || field.imagePath;
        const img = document.createElement('img');
        img.className = 'print-attachment-img';
        img.src = `/medic/${docId}/${attName}`;
        img.alt = field.value || 'Attachment';
        row.appendChild(img);
      } else if (field.attachmentInfo?.isPdf) {
        const pdfBadge = document.createElement('div');
        pdfBadge.className = 'print-pdf-badge';
        pdfBadge.innerHTML = `<strong>PDF Attachment:</strong> ${this.escape(field.attachmentInfo.filename || field.value)}`;
        row.appendChild(pdfBadge);
      } else if (field.value !== undefined) {
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = `: ${field.value}`;
        row.appendChild(value);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }
}
