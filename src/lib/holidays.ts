/**
 * Mainland China holiday arrangements, checked 2026-11-24.
 * 2026: State Council General Office, 国办发明电〔2025〕7号, 2025-11-04.
 * https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
 * 2027: State Council General Office notice dated 2026-11-05, republished by MOHRSS.
 * https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml
 * These are holiday rest ranges, not a prediction for any unlisted year.
 */
export interface HolidayRange { name: string; start: string; end: string }
export const HOLIDAY_SOURCES = [
  { year:2026, title:'国务院办公厅关于2026年部分节假日安排的通知', published:'2025-11-04', url:'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html' },
  { year:2027, title:'国务院办公厅关于2027年部分节假日安排的通知', published:'2026-11-05', url:'https://chinajob.mohrss.gov.cn/h5/c/2026-11-09/635850.shtml' },
] as const;
export const HOLIDAYS: HolidayRange[] = [
  {name:'元旦',start:'2026-01-01',end:'2026-01-03'},
  {name:'春节',start:'2026-02-15',end:'2026-02-23'},
  {name:'清明节',start:'2026-04-04',end:'2026-04-06'},
  {name:'劳动节',start:'2026-05-01',end:'2026-05-05'},
  {name:'端午节',start:'2026-06-19',end:'2026-06-21'},
  {name:'中秋节',start:'2026-09-25',end:'2026-09-27'},
  {name:'国庆节',start:'2026-10-01',end:'2026-10-07'},
  {name:'元旦',start:'2027-01-01',end:'2027-01-03'},
  {name:'春节',start:'2027-02-05',end:'2027-02-13'},
  {name:'清明节',start:'2027-04-03',end:'2027-04-05'},
  {name:'劳动节',start:'2027-05-01',end:'2027-05-05'},
  {name:'端午节',start:'2027-06-09',end:'2027-06-09'},
  {name:'中秋节',start:'2027-09-15',end:'2027-09-15'},
  {name:'国庆节',start:'2027-10-01',end:'2027-10-07'},
];
export const OFFICIAL_WORKDAYS = new Set([
  '2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10',
  '2027-01-31','2027-02-14','2027-05-08','2027-09-26','2027-10-09',
]);
