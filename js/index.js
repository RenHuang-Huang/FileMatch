
        let parsedTxtRecords = []; // 儲存所有解析後的 TXT 記錄，用於主頁面
        let parsedExcelRecords = []; // 儲存所有解析後的 Excel 記錄，用於主頁面
        let txtRawDataTableInstance; // 全域變數，用於儲存 TXT 原始資料模態視窗的 DataTable 實例
        let calcTotalDeclaredAmount = 0; // 計算模態視窗的申報總額（來自所有解析後的 TXT 記錄）
        let clinicName = ''; // 儲存診所名稱，用於列印標題

        // 定義 TXT 檔案解析的完整欄位配置
        // 這些配置現在主要用於 DataTables 的欄位定義和數據映射
        const TXT_COLUMN_CONFIG = [
            { header: '病歷號', key: 'medicalRecordId', type: 'string' },
            { header: '姓名', key: 'name', type: 'string' },
            { header: '身份證號', key: 'idNumber', type: 'string' },
            { header: '性別', key: 'gender', type: 'string' },
            { header: '出生日期', key: 'birthDate', type: 'date' },
            { header: '機構代號', key: 'institutionCode', type: 'string' },
            { header: '科別', key: 'department', type: 'string' },
            { header: '就醫日期', key: 'visitDate', type: 'date' },
            { header: '健卡序號', key: 'healthCardSerial', type: 'string' },
            { header: '分類', key: 'category', type: 'string' },
            { header: '醫師代號', key: 'doctorID', type: 'string' },
            { header: '檢驗日期', key: 'inspectionDate', type: 'date' },
            { header: '點數', key: 'points', type: 'number' },
            { header: '成數', key: 'percentage', type: 'number' },
            { header: '金額', key: 'amount', type: 'number' }
        ];

        /**
         * 讀取 TXT 檔案內容。
         * @param {File} file - TXT 檔案物件。
         * @returns {Promise<string>} 檔案內容的 Promise。
         */
        function readTxtFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target.result);
                reader.onerror = (error) => reject(error);
                // 假設 TXT 檔使用 BIG5 編碼
                reader.readAsText(file, 'BIG5');
            });
        }

        /**
         * 讀取 Excel 檔案內容為 ArrayBuffer。
         * @param {File} file - Excel 檔案物件。
         * @returns {Promise<ArrayBuffer>} 檔案內容的 Promise。
         */
        function readExcelFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target.result);
                reader.onerror = (error) => reject(error);
                reader.readAsArrayBuffer(file);
            });
        }

        /**
         * 將各種日期格式正規化為 YYYY-MM-DD，供比對使用。
         * 支援：民國/西元年 + 任意分隔符 (113.05.10、113/5/10、2024-05-10、113年5月10日)、
         *       無分隔數字 (1130510 民國、20240510 西元)、Excel 日期序號、Date 物件。
         * @param {*} value - 原始日期值。
         * @returns {string} YYYY-MM-DD；無法解析時回傳空字串。
         */
        function normalizeDate(value) {
            if (value === null || value === undefined || value === '') return '';
            let y, m, d;

            if (value instanceof Date && !isNaN(value)) {
                y = value.getFullYear(); m = value.getMonth() + 1; d = value.getDate();
            } else if (typeof value === 'number' && value > 0 && value < 100000) {
                // Excel 日期序號 (例如 45422 = 2024-05-10)
                const parsed = XLSX.SSF.parse_date_code(value);
                if (!parsed) return '';
                y = parsed.y; m = parsed.m; d = parsed.d;
            } else {
                const str = String(value).trim();
                const parts = str.split(/[.\/\-\s年月日]+/).filter(Boolean);
                if (parts.length === 3 && parts.every(p => /^\d+$/.test(p))) {
                    [y, m, d] = parts.map(p => parseInt(p, 10));
                } else if (/^\d{8}$/.test(str)) { // 20240510
                    y = +str.slice(0, 4); m = +str.slice(4, 6); d = +str.slice(6);
                } else if (/^\d{6,7}$/.test(str)) { // 1130510 或 990510 (民國)
                    y = +str.slice(0, -4); m = +str.slice(-4, -2); d = +str.slice(-2);
                } else {
                    return '';
                }
            }

            if (y < 1911) y += 1911; // 民國年轉西元
            if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }

        /**
         * 將 YYYY-MM-DD 轉為民國格式 YYY.MM.DD，用於畫面與列印統一顯示。
         * @param {string} isoDate - YYYY-MM-DD。
         * @param {*} fallback - 無法轉換時顯示的原始值。
         * @returns {string}
         */
        function toRocDate(isoDate, fallback = '') {
            if (!isoDate) return fallback === null || fallback === undefined ? '' : String(fallback);
            const [y, m, d] = isoDate.split('-');
            return `${String(+y - 1911).padStart(3, '0')}.${m}.${d}`;
        }

        // 英文字母對應的數值 (身分證／居留證檢查碼用)
        const ID_LETTER_VALUES = {
            A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
            N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33
        };

        /**
         * 檢查身分證／居留證號是否合法 (格式 + 檢查碼)。
         * - 國民身分證：1 英 + [1|2] + 8 碼
         * - 新式居留證 (2021 起)：1 英 + [8|9] + 8 碼
         * - 舊式居留證：2 英 + 8 碼 (第 2 個字母取對應數值的個位數)
         * 加權：字母十位 ×1、個位 ×9，其後 8 碼依序 ×8~×1，最後一碼 ×1，總和可被 10 整除。
         * @param {string} id
         * @returns {boolean}
         */
        function isValidTaiwanId(id) {
            const value = String(id || '').trim().toUpperCase();
            let digits;
            if (/^[A-Z][1289]\d{8}$/.test(value)) {
                digits = value.slice(1).split('').map(Number);
            } else if (/^[A-Z][A-D]\d{8}$/.test(value)) {
                digits = [ID_LETTER_VALUES[value[1]] % 10, ...value.slice(2).split('').map(Number)];
            } else {
                return false;
            }
            const first = ID_LETTER_VALUES[value[0]];
            const weights = [8, 7, 6, 5, 4, 3, 2, 1, 1];
            const sum = Math.floor(first / 10) + (first % 10) * 9
                + digits.reduce((acc, d, i) => acc + d * weights[i], 0);
            return sum % 10 === 0;
        }

        /** 身分證不合法時，該格標淺紅底色並加上說明。 */
        function markInvalidId(cell, id) {
            if (isValidTaiwanId(id)) return;
            cell.classList.add('invalid-id');
            cell.title = id ? '身分證／居留證號格式或檢查碼不正確' : '沒有身分證號';
        }

        /**
         * HTML 跳脫，避免檔案內容 (例如診所名稱) 被當成 HTML 寫入列印視窗。
         */
        function escapeHtml(str) {
            return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        }

        /**
         * 解析 TXT 檔案的資料 (空白字元切割)。
         * 嘗試用空白字元切割字串，並根據欄位順序和特定模式映射。
         * @param {string} data - TXT 檔案的原始字串內容。
         * @param {boolean} extractClinicName - 是否提取診所名稱（僅第一個檔案需要）。
         * @returns {Array<Object>} 解析後的資料陣列。
         */
        function parseTxtDataBySpaces(data, extractClinicName = false) {
            const lines = data.split('\r\n');
            const records = [];
            let dataStarted = false;

            // 提取診所名稱（根據用戶要求，從第8行提取）
            if (extractClinicName && lines.length >= 8 && lines[7].trim()) {
                const eighthLine = lines[7].trim();
                // 第8行通常直接包含診所名稱
                clinicName = eighthLine;
                console.log('提取到的診所名稱（第8行）:', clinicName);
            }

            // 定義正規表達式模式，用於更穩健地識別欄位
            const idNumberRegex = /^([A-Z]\d{9}|[A-Z]{2}\d{8})$/i; // 身分證(1英+9數) 或 舊式居留證(2英+8數)，整段完整比對
            const dateRegex = /\d{2,3}\.\d{2}\.\d{2}/; // 日期 (YY.MM.DD 或 YYY.MM.DD)
            // const healthCardSerialRegex = /^(IC|C)[0-9A-Z]{2}$/i; // 健卡序號 (ICXX 或 CXX)
            const categoryRegex = /^A3$/i; // 分類 (A3)
            // const amountRegex = /^\d+$/; // 純數字金額

            for (const line of lines) {
                // 精確識別標題行
                if (line.includes('病 歷 號') && line.includes('姓    名') && line.includes('金額')) {
                    dataStarted = true;
                    continue;
                }
                // 跳過非資料行或空行，包括分隔線、頁次、診所名稱等
                if (!dataStarted || line.trim() === '' || line.includes('頁次:') ||
                    line.includes('─────────────') || line.includes('══════════════════════════════════════════════════════════') ||
                    line.includes('──── ────')) {
                    continue;
                }

                const record = {};
                let isValidRecord = true;
                const tokens = line.trim().split(/\s+/).filter(token => token !== ''); // 分割並移除空字串

                if (tokens.length === 0) {
                    continue; // 跳過完全空白的行
                }

                // 嘗試從 tokens 中提取資料
                let tokenIndex = 0;

                // 1. 病歷號碼 (通常是第一個數字或數字開頭的字串)
                record.medicalRecordId = tokens[tokenIndex++] || '';

                // 2. 姓名 (可能有多個字，需要判斷)
                // 姓名通常在病歷號碼之後，身份證號碼之前。
                // 這裡假設姓名不會包含身份證號碼、日期等特殊格式
                let nameParts = [];
                while (tokenIndex < tokens.length && !tokens[tokenIndex].match(idNumberRegex) && !tokens[tokenIndex].match(dateRegex) && tokens[tokenIndex].length < 15) {
                    nameParts.push(tokens[tokenIndex++]);
                }
                record.name = nameParts.join('').replace("＊","*").replace("？","?").replace(".",""); // 姓名可能由多個 token 組成

                // 3. 身份證號碼
                if (tokenIndex < tokens.length && tokens[tokenIndex].match(idNumberRegex)) {
                    record.idNumber = tokens[tokenIndex++].toUpperCase();
                } else {
                    record.idNumber = ''; // 如果沒有找到，設定為空
                }

                // 4. 性別 (通常是 男/女)
                record.gender = tokens[tokenIndex++] || '';

                // 5. 出生日期 (不轉換為西元年)
                record.birthDate = tokens[tokenIndex++] || '';

                // 6. 機構代號
                record.institutionCode = tokens[tokenIndex++] || '';

                // 7. 科別
                record.department = tokens[tokenIndex++] || '';

                // 8. 就醫日期 (不轉換為西元年)
                record.visitDate = tokens[tokenIndex++] || '';
                record.visitDateKey = normalizeDate(record.visitDate); // 比對用 (YYYY-MM-DD)

                // 9. 健卡序號
                // 直接按順序解析，不進行格式比對
                if (tokenIndex < tokens.length) {
                    record.healthCardSerial = tokens[tokenIndex++].toUpperCase();
                } else {
                    record.healthCardSerial = '';
                }

                // 10. 分類
                // 直接按順序解析，不進行格式比對
                if (tokenIndex < tokens.length) {
                    record.category = tokens[tokenIndex++].toUpperCase();
                } else {
                    record.category = '';
                }
                
                // 11. 醫師代號
                record.doctorID = tokens[tokenIndex++] || '';

                // 12. 檢驗日期 (不轉換為西元年)
                record.inspectionDate = tokens[tokenIndex++] || '';
                record.inspectionDateKey = normalizeDate(record.inspectionDate); // 比對用 (YYYY-MM-DD)

                // 13. 點數
                record.points = parseInt(tokens[tokenIndex++] || '0', 10);
                if (isNaN(record.points)) record.points = 0;

                // 14. 成數
                record.percentage = parseInt(tokens[tokenIndex++] || '0', 10);
                if (isNaN(record.percentage)) record.percentage = 0;

                // 15. 金額 (通常是最後一個數字)
                record.amount = parseInt(tokens[tokenIndex++] || '0', 10);
                if (isNaN(record.amount)) record.amount = 0;


                // 簡易驗證：確保關鍵欄位不為空或無效
                if (!record.medicalRecordId || !record.name || !record.inspectionDate || isNaN(record.amount)) {
                    isValidRecord = false;
                    console.warn('空白字元解析失敗或關鍵資料缺失，跳過此行:', line, '解析結果:', record);
                }

                if (isValidRecord) {
                    records.push(record);
                }
            }
            return records;
        }


        /**
         * 使用 SheetJS 解析 Excel 檔案的資料。
         * @param {ArrayBuffer} data - Excel 檔案的 ArrayBuffer 內容。
         * @returns {Array<Object>} 解析後的資料陣列。
         */
        function parseExcelData(data) {
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0]; // 預設讀取第一個工作表
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); // 讀取為陣列的陣列

            const records = [];
            let headerRow = null;
            let headerRowIndex = -1;

            // 搜尋標題行，在 Excel 數據中尋找包含所有必要欄位的行
            for (let i = 0; i < Math.min(json.length, 20); i++) {
                const row = json[i];
                if (Array.isArray(row) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('病歷號碼')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('病患姓名')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('身分證')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('生日')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('檢驗日期')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('申報金額')) &&
                    row.some(cell => typeof cell === 'string' && cell.includes('代檢費'))) {
                    headerRow = row.map(cell => typeof cell === 'string' ? cell.trim() : ''); // 清理標題
                    headerRowIndex = i;
                    break;
                }
            }

            if (!headerRow) {
                throw new Error('Excel 文件中找不到包含所有必要欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 身分證, 申報金額, 代檢費) 的標題行。');
            }

            // 根據新的欄位名稱獲取索引
            const medicalRecordIdColIndex = headerRow.indexOf('病歷號碼');
            const nameColIndex = headerRow.indexOf('病患姓名');
            const idCardColIndex = headerRow.indexOf('身分證');
            const birthDateColIndex = headerRow.indexOf('生日');
            const inspectionDateColIndex = headerRow.indexOf('檢驗日期');
            const amountColIndex = headerRow.indexOf('申報金額');
            const declaredFeeColIndex = headerRow.indexOf('代檢費'); // 代檢費欄位
            const visitDateColIndex = headerRow.indexOf('就醫日期'); // 選填：有此欄位時優先用它比對日期

            if (medicalRecordIdColIndex === -1 || nameColIndex === -1 ||
                birthDateColIndex === -1 || inspectionDateColIndex === -1 ||
                idCardColIndex === -1 || amountColIndex === -1 || declaredFeeColIndex === -1) {
                throw new Error('Excel 文件缺少必要的欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 身分證, 或 申報金額, 代檢費)。');
            }

            // 從標題行之後的資料行開始解析
            for (let i = headerRowIndex + 1; i < json.length; i++) {
                const row = json[i];
                if (!Array.isArray(row) || row.length === 0) continue; // 跳過空行或非陣列行

                try {
                    const medicalRecordId = (row[medicalRecordIdColIndex] || '').toString().trim();
                    const name = (row[nameColIndex] || '').toString().trim();
                    // 日期儲存格會是 Excel 序號 (數字)，統一轉成民國格式顯示
                    const rawBirthDate = row[birthDateColIndex];
                    const rawInspectionDate = row[inspectionDateColIndex];
                    const birthDate = typeof rawBirthDate === 'number'
                        ? toRocDate(normalizeDate(rawBirthDate), rawBirthDate)
                        : (rawBirthDate || '').toString().trim();
                    const inspectionDateKey = normalizeDate(rawInspectionDate);
                    const inspectionDate = toRocDate(inspectionDateKey, (rawInspectionDate || '').toString().trim());
                    const rawVisitDate = visitDateColIndex === -1 ? '' : row[visitDateColIndex];
                    const visitDateKey = normalizeDate(rawVisitDate);
                    const visitDate = toRocDate(visitDateKey, (rawVisitDate || '').toString().trim());
                    const idCard = (row[idCardColIndex] || '').toString().trim();
                    const declaredAmount = parseInt((row[amountColIndex] || '0').toString().trim(), 10);
                    const declaredFee = parseInt((row[declaredFeeColIndex] || '0').toString().trim(), 10);

                    if (medicalRecordId && name && birthDate && inspectionDate && idCard && !isNaN(declaredAmount)) {
                        records.push({
                            medicalRecordId: medicalRecordId,
                            name: name,
                            idCard: idCard,
                            birthDate: birthDate,
                            inspectionDate: inspectionDate,
                            inspectionDateKey: inspectionDateKey,
                            visitDate: visitDate,
                            visitDateKey: visitDateKey,
                            declaredAmount: declaredAmount,
                            declaredFee: isNaN(declaredFee) ? 0 : declaredFee
                        });
                    } else {
                        console.warn('無法解析 Excel 行中的關鍵資料，跳過此行:', row);
                    }
                } catch (e) {
                    console.warn('解析 Excel 行時發生錯誤:', row, e);
                }
            }
            return records;
        }

        // --- 比對設定：是否比對就醫日期 (存在 localStorage，預設不比對) ---
        const COMPARE_DATE_STORAGE_KEY = 'fileMatch.compareDate';

        function loadCompareDateSetting() {
            try {
                return localStorage.getItem(COMPARE_DATE_STORAGE_KEY) === 'true';
            } catch (e) {
                return false; // 無痕模式或封鎖儲存時，使用預設值
            }
        }

        function saveCompareDateSetting(enabled) {
            try {
                localStorage.setItem(COMPARE_DATE_STORAGE_KEY, String(enabled));
            } catch (e) {
                console.warn('無法儲存比對設定:', e);
            }
        }

        function isCompareDateEnabled() {
            const toggle = document.getElementById('compareDateToggle');
            return toggle ? toggle.checked : loadCompareDateSetting();
        }

        // 最近一次比對實際使用的日期欄位 ('就醫日期' 或 '檢驗日期')；尚未比對時為空
        let lastDateFieldLabel = '';

        /**
         * 決定日期要比對哪個欄位：兩邊所有資料都有就醫日期時比就醫日期，
         * 否則兩邊都改比檢驗日期 (避免拿一邊的就醫日期去比另一邊的檢驗日期)。
         */
        function chooseDateField(txtRecords, excelRecords) {
            const allHaveVisitDate = [...txtRecords, ...excelRecords].every(r => r.visitDateKey);
            return allHaveVisitDate ? 'visit' : 'inspection';
        }

        function compareRuleLabel() {
            if (!isCompareDateEnabled()) return '身分證 ＋ 申報金額';
            const dateLabel = lastDateFieldLabel || '就醫日期（無則檢驗日期）';
            return `身分證 ＋ ${dateLabel} ＋ 申報金額`;
        }

        function updateCompareRuleText() {
            const el = document.getElementById('compareRuleText');
            if (el) el.textContent = compareRuleLabel();
        }

        /**
         * 執行兩個資料集之間的比對。
         * 找出在一個檔案中存在，但在另一個檔案中不存在的記錄。
         * @param {Array<Object>} txtRecords - 從 TXT 檔案解析的記錄。
         * @param {Array<Object>} excelRecords - 從 Excel 檔案解析的記錄。
         */
        function performComparison(txtRecords, excelRecords) {
            const { txtOnly, excelOnly, ruleLabel, compareDate, dateLabel } = computeComparison(txtRecords, excelRecords);
            lastDateFieldLabel = compareDate ? dateLabel : '';
            updateCompareRuleText();

            displayResults(txtOnly, document.querySelector('#txtMissingInExcel tbody'), document.getElementById('hideZeroTxtAmount'));
            displayResults(excelOnly, document.querySelector('#excelMissingInTxt tbody'), document.getElementById('hideZeroExcelAmount'));
            updateHiddenCounts();
            setHint(document.getElementById('cathayHint'), cathayOnlyHint(excelOnly));

            if (txtOnly.length === 0 && excelOnly.length === 0) {
                showMessageBox(`比對完成！兩份文件所有${ruleLabel.replace(/ ＋ /g, '、')}的資料均匹配。`);
            } else {
                showMessageBox('比對完成！請查看下方表格，找出未匹配的資料。');
            }
        }

        /**
         * 比對計算 (不碰畫面)，單一比對與批次比對共用。
         * @returns {{txtOnly: Array, excelOnly: Array, ruleLabel: string, compareDate: boolean, dateLabel: string}}
         */
        function computeComparison(txtRecords, excelRecords) {
            const txtOnly = [];
            const excelOnly = [];
            const compareDate = isCompareDateEnabled();

            // 日期欄位：優先就醫日期，任一邊沒有就醫日期時改用檢驗日期
            const dateField = chooseDateField(txtRecords, excelRecords);
            const dateLabel = dateField === 'visit' ? '就醫日期' : '檢驗日期';
            const ruleLabel = compareDate ? `身分證 ＋ ${dateLabel} ＋ 申報金額` : '身分證 ＋ 申報金額';
            const displayDateOf = rec => dateField === 'visit' ? rec.visitDate : rec.inspectionDate;

            // 統一兩邊的欄位，比對與顯示都用同一個結構
            // 檢驗日期無法解析時退回原始字串比對；
            // 未勾選「比對就醫日期」時日期一律視為相同，退回「身分證 + 金額」比對
            const dateOf = rec => {
                if (!compareDate) return '';
                return dateField === 'visit' ? rec.visitDateKey : (rec.inspectionDateKey || rec.inspectionDate);
            };
            const toCompare = (rec, source) => source === 'txt'
                ? { id: rec.idNumber, date: dateOf(rec), amount: rec.amount, rec }
                : { id: rec.idCard, date: dateOf(rec), amount: rec.declaredAmount, rec };
            const txtItems = txtRecords.map(r => toCompare(r, 'txt'));
            const excelItems = excelRecords.map(r => toCompare(r, 'excel'));
            const keyOf = item => `${item.id}|${item.date}|${item.amount}`;

            // 依身分證分組，用來判斷不符的原因
            const groupById = items => items.reduce((map, item) => {
                if (!map.has(item.id)) map.set(item.id, []);
                map.get(item.id).push(item);
                return map;
            }, new Map());
            const txtById = groupById(txtItems);
            const excelById = groupById(excelItems);

            /**
             * 判斷未匹配的原因，並附上對方的值方便核對。
             * @param {Object} item - 本方記錄。
             * @param {Array} others - 對方同身分證的記錄。
             * @param {string} otherLabel - 對方名稱 (國泰/診所)。
             */
            const describeMismatch = (item, others, otherLabel) => {
                if (!others || others.length === 0) return '未找到';
                const sameDate = others.filter(o => o.date === item.date);
                if (sameDate.length > 0) {
                    return `金額不符，${otherLabel} ${sameDate.map(o => o.amount).join('、')}`;
                }
                const sameAmount = others.filter(o => o.amount === item.amount);
                if (sameAmount.length > 0) {
                    return `${dateLabel}不符，${otherLabel} ${sameAmount.map(o => displayDateOf(o.rec)).join('、')}`;
                }
                return `${dateLabel}及金額皆不符`;
            };

            // 建立以「身分證 + 檢驗日期 + 金額」為鍵的 Map，同鍵多筆用陣列保存，配對一筆扣一筆
            const excelMap = new Map();
            for (const item of excelItems) {
                const key = keyOf(item);
                if (!excelMap.has(key)) excelMap.set(key, []);
                excelMap.get(key).push(item);
            }

            const excelKeys = new Set(excelMap.keys());

            // 第一階段比對：從 TXT 尋找 Excel
            for (const item of txtItems) {
                const key = keyOf(item);
                const potentialMatches = excelMap.get(key);
                if (potentialMatches && potentialMatches.length > 0) {
                    potentialMatches.shift();
                    if (potentialMatches.length === 0) excelMap.delete(key);
                } else if (excelKeys.has(key)) {
                    // 完全相同的資料在國泰存在，但筆數比診所少
                    txtOnly.push(toDisplayRow(item.rec, 'txt', '重複資料，國泰筆數較少'));
                } else {
                    txtOnly.push(toDisplayRow(item.rec, 'txt', describeMismatch(item, excelById.get(item.id), '國泰')));
                }
            }

            // 第二階段比對：從 Excel 尋找 TXT
            const txtKeys = new Set(txtItems.map(keyOf));
            for (const item of excelItems) {
                const rec = item.rec;
                const reasons = [];
                if (!txtKeys.has(keyOf(item))) {
                    reasons.push(describeMismatch(item, txtById.get(item.id), '診所'));
                }

                // 申報金額為 0 但代檢費不為 0：一律列出，且不受「隱藏 0 元」影響
                const hasAgencyFeeOnly = rec.declaredAmount === 0 && rec.declaredFee > 0;
                if (hasAgencyFeeOnly) {
                    reasons.push(`代檢費 ${rec.declaredFee}`);
                }

                if (reasons.length > 0) {
                    excelOnly.push(toDisplayRow(rec, 'excel', reasons.join('，'), hasAgencyFeeOnly));
                }
            }

            return { txtOnly, excelOnly, ruleLabel, compareDate, dateLabel };
        }

        /**
         * 執行兩個資料集之間的比對。
         */
        async function compareFiles() {
            const txtFiles = document.getElementById('txtFile').files;
            const excelFiles = document.getElementById('excelFile').files;

            // 檢查是否同時上傳了檔案
            if (txtFiles.length === 0 || excelFiles.length === 0) {
                showMessageBox('請同時上傳 TXT 檔和 Excel 檔。');
                return;
            }

            // 清除之前的比對結果並禁用相關按鈕
            clearResults();
            document.getElementById('printResultsBtn').disabled = true;
            document.getElementById('unhideAllBtn').disabled = true;
            document.getElementById('openCalcModalBtn').disabled = true; // 禁用計算按鈕
            document.getElementById('openCalcModalBtn').classList.remove('enabled'); // 移除啟用樣式
            document.getElementById('openTxtRawModalBtn').disabled = true; // 禁用 TXT 原始資料按鈕

            parsedTxtRecords = [];
            parsedExcelRecords = [];
            clinicName = ''; // 重置診所名稱

            try {
                // 處理多個 TXT 檔案
                for (let i = 0; i < txtFiles.length; i++) {
                    const txtFile = txtFiles[i];
                    const txtData = await readTxtFile(txtFile);
                    const txtRecords = parseTxtDataBySpaces(txtData, i === 0); // 只在第一個檔案時提取診所名稱
                    parsedTxtRecords.push(...txtRecords);
                }

                // 處理多個 Excel 檔案
                for (let i = 0; i < excelFiles.length; i++) {
                    const excelFile = excelFiles[i];
                    const excelData = await readExcelFile(excelFile);
                    const excelRecords = parseExcelData(excelData);
                    parsedExcelRecords.push(...excelRecords);
                }

                // 計算 TXT 申報總額 (用於計算模態視窗)
                calcTotalDeclaredAmount = parsedTxtRecords.reduce((sum, record) => sum + (record.amount || 0), 0);
                console.log("申報總額:"+calcTotalDeclaredAmount)
                // 更新讀取資料總數顯示
                document.getElementById('txtReadCount').textContent = `(讀取 ${parsedTxtRecords.length} 筆資料)`;
                document.getElementById('excelReadCount').textContent = `(讀取 ${parsedExcelRecords.length} 筆資料)`;

                // 啟用相關按鈕
                document.getElementById('printResultsBtn').disabled = false;
                document.getElementById('unhideAllBtn').disabled = false;
                document.getElementById('openCalcModalBtn').disabled = false; // 啟用計算按鈕
                document.getElementById('openCalcModalBtn').classList.add('enabled'); // 添加啟用樣式
                document.getElementById('openTxtRawModalBtn').disabled = false; // 啟用 TXT 原始資料按鈕

                // 執行資料比對
                performComparison(parsedTxtRecords, parsedExcelRecords);

            } catch (error) {
                console.error('檔案處理錯誤:', error);
                showMessageBox('檔案處理失敗，請檢查檔案格式或編碼是否正確。錯誤訊息: ' + error.message);
            }
        }

        /**
         * 將結果顯示在指定的表格中。
         * @param {Array<Object>} records - 要顯示的記錄陣列。
         * @param {HTMLElement} tableBodyElement - 目標表格的 tbody 元素。
         * @param {HTMLInputElement} hideZeroAmountCheckbox - 隱藏金額為0的勾選框元素。
         */
        /**
         * 將 TXT / Excel 記錄轉成統一的顯示結構。
         * @param {Object} rec - 原始記錄。
         * @param {'txt'|'excel'} source - 資料來源。
         * @param {string} reason - 未匹配原因。
         * @param {boolean} alwaysShow - 是否不受「隱藏金額為 0」影響 (例如有代檢費)。
         */
        function toDisplayRow(rec, source, reason, alwaysShow = false) {
            return {
                reason,
                medicalRecordId: rec.medicalRecordId,
                name: rec.name,
                idCard: source === 'txt' ? rec.idNumber : rec.idCard,
                birthDate: rec.birthDate,
                inspectionDate: rec.inspectionDate,
                amount: source === 'txt' ? rec.amount : rec.declaredAmount,
                alwaysShow
            };
        }

        function displayResults(records, tableBodyElement, hideZeroAmountCheckbox) {
            tableBodyElement.innerHTML = '';

            if (records.length === 0) {
                const row = tableBodyElement.insertRow();
                const cell = row.insertCell();
                cell.colSpan = 8; // 隱藏 + 7 個資料欄位
                cell.textContent = '所有資料皆已匹配。';
                cell.classList.add('no-match-message');
                return;
            }

            records.forEach(record => {
                const row = tableBodyElement.insertRow();
                // 新增勾選方框的單元格
                const checkboxCell = row.insertCell();
                checkboxCell.classList.add('hide-row-checkbox-cell'); // 添加 class 以便列印時隱藏
                const label = document.createElement('label'); // 使用 label 包裹 checkbox
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.classList.add('hide-row-checkbox'); // 添加 class 以便選擇
                checkbox.setAttribute('aria-label', `隱藏此列：${record.name} ${record.inspectionDate}`);
                label.appendChild(checkbox);
                checkboxCell.appendChild(label); // 將 label 添加到 td 中


                row.insertCell().textContent = record.reason;
                row.insertCell().textContent = record.medicalRecordId;
                row.insertCell().textContent = record.name;
                const idCell = row.insertCell();
                idCell.textContent = record.idCard;
                markInvalidId(idCell, record.idCard);
                row.insertCell().textContent = record.birthDate;
                row.insertCell().textContent = record.inspectionDate;
                const amountCell = row.insertCell();
                // 申報金額為 0 但有代檢費的資料，沿用原本的「申報金額: 0 元」顯示方式 (只改顯示文字，不改資料)
                amountCell.textContent = record.alwaysShow
                    ? `申報金額: ${record.amount.toLocaleString()} 元`
                    : record.amount.toLocaleString();
                amountCell.classList.add('amount-cell');

                // 金額為 0 才受「隱藏金額為 0」控制；alwaysShow (有代檢費) 的資料一律顯示
                row.dataset.amountZero = (record.amount === 0 && !record.alwaysShow).toString();
                if (record.alwaysShow) row.classList.add('agency-fee-row');

                row.dataset.hiddenByCheckbox = 'false'; // 初始狀態為未被獨立勾選框隱藏

                // 初始應用隱藏狀態
                updateRowVisibility(row, hideZeroAmountCheckbox);

                // 為獨立勾選框添加事件監聽器
                checkbox.addEventListener('change', function() {
                    row.dataset.hiddenByCheckbox = this.checked.toString();
                    updateRowVisibility(row, hideZeroAmountCheckbox);
                });
            });
        }

        /**
         * 更新單行資料的顯示/隱藏狀態。
         * @param {HTMLElement} row - 要更新的表格行元素。
         * @param {HTMLInputElement} hideZeroAmountCheckbox - 隱藏金額為0的勾選框元素。
         */
        function updateRowVisibility(row, hideZeroAmountCheckbox) {
            const isAmountZero = row.dataset.amountZero === 'true';
            const isHiddenByIndividualCheckbox = row.dataset.hiddenByCheckbox === 'true';
            const isHideZeroAmountChecked = hideZeroAmountCheckbox.checked;

            // 如果被獨立勾選框隱藏，或者金額為0且隱藏金額為0的勾選框被勾選，則隱藏該行
            if (isHiddenByIndividualCheckbox || (isAmountZero && isHideZeroAmountChecked)) {
                row.classList.add('hidden-row');
            } else {
                row.classList.remove('hidden-row');
            }
        }

        /**
         * 根據勾選框狀態顯示或隱藏金額為0的行。
         * 此函數現在會重新評估所有行的可見性。
         * @param {HTMLElement} tableBodyElement - 目標表格的 tbody 元素。
         * @param {HTMLInputElement} hideZeroAmountCheckbox - 隱藏金額為0的勾選框元素。
         */
        function toggleRowsVisibility(tableBodyElement, hideZeroAmountCheckbox) {
            const rows = tableBodyElement.querySelectorAll('tr');
            rows.forEach(row => {
                updateRowVisibility(row, hideZeroAmountCheckbox);
            });
            updateHiddenCounts();
        }

        /**
         * 顯示所有隱藏的資料 (僅取消單獨勾選的隱藏，不影響金額為0的篩選)。
         */
        /** 表格上方「隱藏申報金額為 0」的勾選框 (結構：勾選框群組緊接著表格)。 */
        function hideZeroCheckboxOf(table) {
            const group = table.previousElementSibling;
            return group && group.classList.contains('hide-zero-amount-checkbox-group') ? group.querySelector('input[type="checkbox"]') : null;
        }

        function unhideAllRows(scope = document.querySelector('.results-section')) {
            // 取消勾選每一列的隱藏方框，再依「隱藏金額為0」的狀態重新評估
            scope.querySelectorAll('table').forEach(table => {
                const hideZeroCheckbox = hideZeroCheckboxOf(table);
                if (!hideZeroCheckbox) return;
                table.querySelectorAll('tbody tr').forEach(row => {
                    const individualCheckbox = row.querySelector('.hide-row-checkbox');
                    if (individualCheckbox) {
                        individualCheckbox.checked = false;
                        row.dataset.hiddenByCheckbox = 'false';
                    }
                    updateRowVisibility(row, hideZeroCheckbox);
                });
            });

            showMessageBox('所有被勾選隱藏的資料已顯示。');
        }


        /**
         * 執行列印功能 (單一比對)。
         */
        function printResults() {
            openPrintWindow([{
                title: clinicName,
                subtitle: `比對條件: ${compareRuleLabel()}`,
                blocks: extractPrintBlocks(document.querySelector('.results-section'))
            }]);
        }

        /**
         * 從結果區塊擷取要列印的「標題 + 表格」，移除勾選框、被隱藏的列等畫面專用內容。
         * @param {HTMLElement} sectionEl - 含 h2 + table 的結果區塊。
         * @returns {string[]} 每個元素是一張表格的 HTML。
         */
        function extractPrintBlocks(sectionEl) {
            const cloned = sectionEl.cloneNode(true);
            cloned.querySelectorAll('.hide-zero-amount-checkbox-group, .record-count, .screen-only, .hide-row-checkbox-cell, br')
                .forEach(el => el.remove());
            cloned.querySelectorAll('tbody tr.hidden-row').forEach(row => row.remove());

            const blocks = [];
            cloned.querySelectorAll('h2').forEach(h2 => {
                const table = h2.nextElementSibling && h2.nextElementSibling.tagName === 'TABLE' ? h2.nextElementSibling : null;
                if (!table) return;
                // 隱藏後沒有任何資料列時，補上提示，避免印出空表格
                if (table.querySelectorAll('tbody tr').length === 0) {
                    table.querySelector('tbody').innerHTML = '<tr><td class="no-match-message" colspan="7">無資料</td></tr>';
                }
                blocks.push(`<div class="result-block">${h2.outerHTML}${table.outerHTML}</div>`);
            });
            return blocks;
        }

        /**
         * 開列印視窗。每個 page 是一家診所：頁首 (診所名稱、比對條件、列印時間) 在該診所的每一頁重複，
         * 診所之間、表格之間都換頁。
         * @param {Array<{title: string, subtitle: string, blocks: string[]}>} pages subtitle 例如「比對條件: 身分證 ＋ 申報金額」
         */
        function openPrintWindow(pages) {
            const printWindow = window.open('', '_blank');
            printWindow.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>比對結果列印</title>');
            // 列印視窗不載入外部 CSS：外部檔案若在列印當下還沒載好，表格會變成雙線框、表頭置中。
            // 需要的樣式全部寫在這裡，列印結果不受載入時間影響
            printWindow.document.write('<style>');
            printWindow.document.write(`
                /* 寬度固定為 A4 扣除左右邊界 (210mm - 10mm x 2)，字級依此寬度自動計算 */
                body { display: block; background: #fff; padding: 0; margin: 0; min-height: 0; width: 190mm;
                       font-family: 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', system-ui, sans-serif; }
                /* 外觀沿用原版列印：黑色框線與文字、表頭 #f0f0f0、偶數列淺灰、標題一般粗細。
                   直接寫在列印視窗 (畫面與列印都套用)，量字級時與實際列印的版面一致 */
                h2 { font-size: 20px; justify-content: center; text-align: center; margin: 20px 0 10px; white-space: nowrap;
                     font-weight: normal; color: #000; }
                table { width: 100%; border-collapse: collapse; background: #fff; font-size: 16px; }
                table th, table td { padding: 0.4em 0.45em; white-space: nowrap; border: 1px solid #000; color: #000;
                                     text-align: left; font-variant-numeric: tabular-nums; }
                table th { background-color: #f0f0f0; font-weight: 600; }
                table td.amount-cell { text-align: right; }
                tr.agency-fee-row td { background-color: #fff8e1; }
                table td.invalid-id { background-color: #fbebeb; }
                /* 瀏覽器預設不印背景色：代檢費 (黃底) 與身分證不合法 (紅底) 強制印出 */
                tr.agency-fee-row td, table td.invalid-id { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                tr.batch-health-total td { font-weight: 700; background-color: #f0f0f0; }
                .result-block:first-child > table:first-child { margin-top: 16px; }
                .result-block table tbody tr:nth-child(even) { background-color: #f8f9fa; }
                /* 固定版面：內容過寬時不會撐開外層，才量得出真正是否超出 A4 */
                .page-layout { width: 100%; table-layout: fixed; page-break-after: always; break-after: page; }
                .page-layout:last-of-type { page-break-after: auto; break-after: auto; }
                .page-layout, .page-layout > thead > tr > th, .page-layout > tbody > tr > td {
                    border: none; padding: 0; background: none; box-shadow: none; margin: 0; }
                .clinic-title { text-align: center; font-size: 26px; font-weight: bold; margin: 0;
                                padding: 4px 0; border-bottom: 1px solid #ccc; color: #2c3e50; }
                .print-time { text-align: right; font-size: 13px; color: #555; font-weight: normal; padding: 2px 0 8px; }
                .result-block { page-break-after: always; break-after: page; }
                .result-block:last-child { page-break-after: auto; break-after: auto; }
                tr { page-break-inside: avoid; break-inside: avoid; }
                thead { display: table-header-group; } /* 跨頁時重複表頭 */
                .no-match-message { text-align: center !important; font-style: italic; color: #666 !important; padding: 15px; }
                @page { size: A4; margin: 12mm 10mm; }
            `);
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');

            // 用外層表格的 thead 放診所名稱：列印時每頁都會重複，且不會像 position:fixed 一樣蓋住內容
            const printTime = new Date().toLocaleString('zh-TW');
            pages.forEach(page => {
                const titleHtml = page.title ? `<div class="clinic-title">${escapeHtml(page.title)}</div>` : '';
                printWindow.document.write(`
                    <table class="page-layout">
                        <thead><tr><th>${titleHtml}<div class="print-time">${escapeHtml(page.subtitle)}　列印時間: ${printTime}</div></th></tr></thead>
                        <tbody><tr><td>${page.blocks.join('')}</td></tr></tbody>
                    </table>`);
            });
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            printWindow.focus();

            // 等待內容與字型載入完成，計算字級後再列印
            const fitThenPrint = () => {
                const fontsReady = printWindow.document.fonts ? printWindow.document.fonts.ready : Promise.resolve();
                fontsReady.then(() => {
                    fitPrintFontSize(printWindow.document);
                    printWindow.print();
                });
            };
            if (printWindow.document.readyState === 'complete') {
                fitThenPrint();
            } else {
                printWindow.onload = fitThenPrint;
            }
        }

        /**
         * 以二分搜尋找出「每一列都不換行、表格不超出 A4 寬度」的最大字級。
         * 每家診所 (每個 .page-layout) 各自計算：同一家的兩張表格使用同一個字級，表格標題各自計算。
         * 資料過長、縮到最小字級仍放不下時，才允許換行。
         * @param {Document} doc - 列印視窗的 document。
         */
        function fitPrintFontSize(doc) {
            const available = doc.body.getBoundingClientRect().width; // 190mm 的實際像素寬度
            return [...doc.querySelectorAll('.page-layout')].map(layout => fitPrintLayout(layout, available));
        }

        function fitPrintLayout(layout, available) {
            const MIN_SIZE = 9, MAX_SIZE = 24;
            const largestFitting = (apply, fits) => {
                let lo = MIN_SIZE, hi = MAX_SIZE;
                apply(lo);
                if (!fits()) return null;
                while (hi - lo > 0.25) {
                    const mid = (lo + hi) / 2;
                    apply(mid);
                    if (fits()) lo = mid; else hi = mid;
                }
                const size = Math.floor(lo * 2) / 2; // 取到 0.5px，保守一點
                apply(size);
                return size;
            };

            const tables = [...layout.querySelectorAll('.result-block table')];
            const tableSize = largestFitting(
                size => tables.forEach(t => { t.style.fontSize = `${size}px`; }),
                () => tables.every(t => t.offsetWidth <= available + 1)
            );
            if (tableSize === null) {
                tables.forEach(t => {
                    t.style.fontSize = `${MIN_SIZE}px`;
                    t.querySelectorAll('th, td').forEach(c => { c.style.whiteSpace = 'normal'; });
                });
            }

            layout.querySelectorAll('.result-block h2').forEach(h2 => {
                const size = largestFitting(
                    s => { h2.style.fontSize = `${s}px`; },
                    () => h2.scrollWidth <= h2.clientWidth + 1
                );
                if (size === null) h2.style.whiteSpace = 'normal';
            });
            return tableSize;
        }

        /**
         * 清除結果表格的內容。
         */
        function clearResults() {
            document.querySelector('#txtMissingInExcel tbody').innerHTML = '';
            document.querySelector('#excelMissingInTxt tbody').innerHTML = '';
            document.getElementById('hideZeroTxtAmount').checked = false;
            document.getElementById('hideZeroExcelAmount').checked = true;
            // 比對按鈕的啟用狀態只由「是否已選檔案」決定 (checkFilesAndEnableButton)，這裡不動它，
            // 否則比對完後按鈕會被停用，必須重選檔案才能再比對
            document.getElementById('printResultsBtn').disabled = true;
            document.getElementById('unhideAllBtn').disabled = true;
            document.getElementById('openCalcModalBtn').disabled = true; // 禁用計算按鈕
            document.getElementById('openCalcModalBtn').classList.remove('enabled'); // 移除啟用樣式
            document.getElementById('openTxtRawModalBtn').disabled = true; // 禁用 TXT 原始資料按鈕

            // 重置讀取資料總數顯示
            document.getElementById('txtReadCount').textContent = '(讀取 0 筆資料)';
            document.getElementById('excelReadCount').textContent = '(讀取 0 筆資料)';
            document.getElementById('hideZeroTxtCount').textContent = '';
            document.getElementById('hideZeroExcelCount').textContent = '';
            lastDateFieldLabel = '';
            updateCompareRuleText();
            setHint(document.getElementById('cathayHint'), '');
        }

        /**
         * 顯示自定義訊息框。
         * @param {string} message - 要顯示的訊息。
         */
        function showMessageBox(message) {
            const messageBox = document.createElement('div');
            messageBox.className = 'message-box'; // 樣式在 index.css；列印時隱藏
            messageBox.setAttribute('role', 'status');
            messageBox.setAttribute('aria-live', 'polite');
            messageBox.textContent = message;
            document.body.appendChild(messageBox);

            requestAnimationFrame(() => messageBox.classList.add('show'));
            setTimeout(() => {
                messageBox.classList.remove('show');
                setTimeout(() => messageBox.remove(), 300);
            }, 3500);
        }

        // --- Modal 共用：Esc / 點背景關閉、開啟時移動焦點、關閉後還原焦點 ---
        let lastFocusedBeforeModal = null;

        function showModal(modal) {
            lastFocusedBeforeModal = document.activeElement;
            modal.style.display = 'flex';
            const closeBtn = modal.querySelector('.close-button');
            if (closeBtn) closeBtn.focus();
        }

        function restoreFocusAfterModal() {
            if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
                lastFocusedBeforeModal.focus();
            }
            lastFocusedBeforeModal = null;
        }

        /**
         * 更新「隱藏申報金額為 0 的資料」旁的已隱藏筆數。
         */
        function updateHiddenCounts() {
            document.querySelectorAll('.hide-zero-amount-checkbox-group').forEach(group => {
                const table = group.nextElementSibling;
                const checkbox = group.querySelector('input[type="checkbox"]');
                const countEl = group.querySelector('.hidden-count');
                if (!table || table.tagName !== 'TABLE' || !checkbox || !countEl) return;
                const zeroRows = table.querySelectorAll('tbody tr[data-amount-zero="true"]').length;
                countEl.textContent = zeroRows > 0 ? `（${checkbox.checked ? '已隱藏' : '共'} ${zeroRows} 筆）` : '';
            });
        }

        // --- Calculation Modal Functions ---

        /**
         * 開啟成健金額計算模態視窗。
         */
        function openCalcModal() {
            const calcModal = document.getElementById('calcModal');
            const calcTotalDeclaredAmountSpan = document.getElementById('calcTotalDeclaredAmount');
            const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage');

            if (parsedTxtRecords.length === 0) {
                showMessageBox('請先上傳並比對 TXT 檔案以載入資料。');
                return;
            }

            // 申報總額：顯示未經過篩選後資料的金額總和。
            // calcTotalDeclaredAmount 已經是所有 TXT 檔案資料的總金額 (未篩選的總和)。
            calcTotalDeclaredAmountSpan.textContent = calcTotalDeclaredAmount.toLocaleString();
            calcDiscountPercentageInput.value = loadDiscountSetting();

            // 執行金額計算顯示
            updateAllCalculationsForCalcModal();

            showModal(calcModal);
        }

        /**
         * 關閉成健金額計算模態視窗。
         */
        function closeCalcModal() {
            document.getElementById('calcModal').style.display = 'none';
            restoreFocusAfterModal();
        }

        /**
         * 列印成健金額計算結果。
         */
        function printCalcModal() {
            const printWindow = window.open('', '_blank');
            printWindow.document.write('<html><head><title>成健金額計算結果</title>');
            printWindow.document.write('<meta charset="UTF-8">');
            printWindow.document.write('<style>');
            printWindow.document.write(`
                body { 
                    margin: 20px; 
                    font-family: 'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', system-ui, sans-serif; 
                    line-height: 1.6;
                }
                .print-calc-title { 
                    text-align: center; 
                    font-size: 24px; 
                    font-weight: bold; 
                    margin-bottom: 30px;
                    padding: 10px 0;
                    border-bottom: 2px solid #333;
                }
                .print-calc-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-top: 20px;
                    max-width: 800px;
                    margin-left: auto;
                    margin-right: auto;
                }
                .print-calc-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 15px;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    background-color: #f9f9f9;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .print-calc-label {
                    font-weight: bold;
                    color: #333;
                }
                .print-calc-value {
                    color: #007bff;
                    font-weight: bold;
                    font-size: 1.1em;
                }
                .print-footer {
                    text-align: center; 
                    margin-top: 30px; 
                    font-size: 12px; 
                    color: #666;
                    border-top: 1px solid #eee;
                    padding-top: 15px;
                }
                
                @media print {
                    body { 
                        margin: 15mm; 
                        font-size: 14px;
                    }
                    .print-calc-title {
                        font-size: 20px;
                        margin-bottom: 25px;
                    }
                    .print-calc-grid {
                        gap: 15px;
                        grid-template-columns: 1fr 1fr;
                    }
                    .print-calc-item {
                        padding: 12px;
                        break-inside: avoid;
                    }
                    .print-calc-value {
                        color: #000 !important;
                    }
                }
            `);
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');

            // 添加診所名稱和標題
            if (clinicName) {
                printWindow.document.write(`<h1 class="print-calc-title">${escapeHtml(clinicName)}<br>成健金額計算結果</h1>`);
            } else {
                printWindow.document.write('<h1 class="print-calc-title">成健金額計算結果</h1>');
            }

            // 獲取計算結果數據
            const discountPercentage = document.getElementById('calcDiscountPercentage').value;
            const totalDeclaredAmount = document.getElementById('calcTotalDeclaredAmount').textContent;
            const filteredAmount = document.getElementById('calcFilteredAmount').textContent;
            const nonFilteredAmount = document.getElementById('calcNonFilteredAmount').textContent;
            const deductionAmount = document.getElementById('calcDeductionAmount').textContent;

            // 添加計算結果
            printWindow.document.write('<div class="print-calc-grid">');
            printWindow.document.write(`<div class="print-calc-item"><span class="print-calc-label">打折的成數 (%):</span><span class="print-calc-value">${discountPercentage}%</span></div>`);
            printWindow.document.write(`<div class="print-calc-item"><span class="print-calc-label">申報總額:</span><span class="print-calc-value">${totalDeclaredAmount}</span></div>`);
            printWindow.document.write(`<div class="print-calc-item"><span class="print-calc-label">成健金額:</span><span class="print-calc-value">${filteredAmount}</span></div>`);
            printWindow.document.write(`<div class="print-calc-item"><span class="print-calc-label">非成健金額:</span><span class="print-calc-value">${nonFilteredAmount}</span></div>`);
            printWindow.document.write(`<div class="print-calc-item"><span class="print-calc-label">預扣額:</span><span class="print-calc-value">${deductionAmount}</span></div>`);
            printWindow.document.write('</div>');

            // 添加列印時間
            const printDate = new Date().toLocaleString('zh-TW');
            printWindow.document.write(`<p class="print-footer">列印時間: ${printDate}</p>`);

            printWindow.document.write('</body></html>');
            printWindow.document.close();

            // 等待較長時間確保內容完全加載
            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 500);
        }

        /**
         * 更新計算模態視窗中所有金額計算結果的顯示。
         */
        // --- 打折的成數：存在 localStorage，單一的計算視窗與批次總表共用，預設 15% ---
        const DISCOUNT_STORAGE_KEY = 'fileMatch.discountPercentage';
        const DEFAULT_DISCOUNT = '15';

        function loadDiscountSetting() {
            try {
                const saved = localStorage.getItem(DISCOUNT_STORAGE_KEY);
                const n = parseFloat(saved);
                return saved !== null && !isNaN(n) && n >= 0 && n <= 100 ? saved : DEFAULT_DISCOUNT;
            } catch (e) {
                return DEFAULT_DISCOUNT; // 無痕模式或封鎖儲存時，使用預設值
            }
        }

        function saveDiscountSetting(value) {
            const n = parseFloat(value);
            if (isNaN(n) || n < 0 || n > 100) return; // 輸入到一半或超出範圍時不存
            try {
                localStorage.setItem(DISCOUNT_STORAGE_KEY, String(value));
            } catch (e) {
                console.warn('無法儲存打折成數:', e);
            }
        }

        /**
         * 成健金額計算 (單一的計算視窗與批次總表共用)。
         * 成健 = 分類 A3 且健卡序號 IC 開頭；非成健 = 申報總額 - 成健；預扣額 = 非成健 × 打折成數。
         * @param {Array<Object>} txtRecords - 診所 TXT 記錄。
         * @param {number} discountPercentage - 打折的成數 (%)。
         */
        function calcHealthAmounts(txtRecords, discountPercentage) {
            const total = txtRecords.reduce((sum, r) => sum + (r.amount || 0), 0);
            const filtered = txtRecords
                .filter(r => r.category && r.category.trim().toUpperCase() === 'A3'
                    && r.healthCardSerial && r.healthCardSerial.trim().toUpperCase().startsWith('IC'))
                .reduce((sum, r) => sum + (r.amount || 0), 0);
            const nonFiltered = total - filtered;
            const discount = parseFloat(discountPercentage) / 100;
            const deduction = nonFiltered * (isNaN(discount) ? 0 : discount);
            return { total, filtered, nonFiltered, deduction };
        }

        function updateAllCalculationsForCalcModal() {
            const calcTotalDeclaredAmountSpan = document.getElementById('calcTotalDeclaredAmount');
            const calcFilteredAmountSpan = document.getElementById('calcFilteredAmount');
            const calcNonFilteredAmountSpan = document.getElementById('calcNonFilteredAmount');
            const calcDeductionAmountSpan = document.getElementById('calcDeductionAmount');
            const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage');

            const amounts = calcHealthAmounts(parsedTxtRecords, calcDiscountPercentageInput.value);
            calcTotalDeclaredAmountSpan.textContent = amounts.total.toLocaleString();
            calcFilteredAmountSpan.textContent = amounts.filtered.toLocaleString();
            calcNonFilteredAmountSpan.textContent = amounts.nonFiltered.toLocaleString();
            calcDeductionAmountSpan.textContent = amounts.deduction.toLocaleString();
        }

        // --- TXT Raw Data Modal Functions ---

        /**
         * 開啟 TXT 原始資料模態視窗。
         */
        async function openTxtRawModal() {
            const txtRawModal = document.getElementById('txtRawModal');
            const txtFiles = document.getElementById('txtFile').files;

            if (txtFiles.length === 0) {
                showMessageBox('請先上傳 TXT 檔案以載入資料。');
                return;
            }

            // 處理多個 TXT 檔案
            let allRawParsedRecords = [];
            for (let i = 0; i < txtFiles.length; i++) {
                const txtFile = txtFiles[i];
                const txtData = await readTxtFile(txtFile);
                // 使用 parseTxtDataBySpaces 函數 (空白鍵解析方式)，不需要重新提取診所名稱
                const rawParsedRecords = parseTxtDataBySpaces(txtData, false);
                allRawParsedRecords.push(...rawParsedRecords);
            }

            // 如果 DataTable 實例已存在，則銷毀它
            if ($.fn.DataTable.isDataTable('#txtRawDataTable')) {
                $('#txtRawDataTable').DataTable().destroy();
                $('#txtRawDataTable thead').empty().append('<tr></tr>');
                $('#txtRawDataTable tbody').empty();
            }

            const dataTableColumns = TXT_COLUMN_CONFIG.map(col => ({
                title: col.header,
                data: col.key,
                ...(col.key === 'idNumber' ? { createdCell: (cell, value) => markInvalidId(cell, value) } : {})
            }));

            txtRawDataTableInstance = $('#txtRawDataTable').DataTable({
                data: allRawParsedRecords,
                columns: dataTableColumns,
                paging: false, // 移除分頁
                searching: true, // 允許搜尋
                ordering: true, // 允許排序
                info: true,
                lengthChange: false, // 隱藏 "Show X entries" 下拉選單
                language: {
                    url: './zh-HANT.json'
                },
                initComplete: function () {
                    // 調整欄位寬度
                    this.api().columns.adjust().draw();
                }
            });

            showModal(txtRawModal);
        }

        /**
         * 關閉 TXT 原始資料模態視窗。
         */
        function closeTxtRawModal() {
            document.getElementById('txtRawModal').style.display = 'none';
            restoreFocusAfterModal();
            if (txtRawDataTableInstance) {
                txtRawDataTableInstance.destroy();
                txtRawDataTableInstance = null;
                $('#txtRawDataTable thead').empty().append('<tr></tr>');
                $('#txtRawDataTable tbody').empty();
            }
        }

        /**
         * 匯出 TXT 原始資料模態視窗中表格資料到 Excel 檔案。
         */
        function exportTxtRawTableToExcel() {
            if (!txtRawDataTableInstance || txtRawDataTableInstance.rows().count() === 0) {
                showMessageBox('目前沒有原始資料可以匯出。請先解析 TXT 檔案。');
                return;
            }

            // 獲取 DataTables 中當前顯示的所有資料 (包括搜尋和排序後的結果)
            const dataToExport = txtRawDataTableInstance.rows({ search: 'applied' }).data().toArray();

            const headers = TXT_COLUMN_CONFIG.map(col => col.header);
            const exportData = [headers];

            dataToExport.forEach(record => {
                const row = TXT_COLUMN_CONFIG.map(col => record[col.key]);
                exportData.push(row);
            });

            const worksheet = XLSX.utils.aoa_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "TXT原始資料");

            const fileName = `TXT_原始資料_${new Date().toISOString().slice(0,10)}.xlsx`;
            XLSX.writeFile(workbook, fileName);

            showMessageBox('原始資料已成功匯出為 Excel 檔案！');
        }


        document.addEventListener('DOMContentLoaded', () => {
            // 獲取 DOM 元素
            const txtFileInput = document.getElementById('txtFile');
            const excelFileInput = document.getElementById('excelFile');
            const compareBtn = document.getElementById('compareBtn');
            const printResultsBtn = document.getElementById('printResultsBtn');
            const unhideAllBtn = document.getElementById('unhideAllBtn');
            const hideZeroTxtAmountCheckbox = document.getElementById('hideZeroTxtAmount');
            const hideZeroExcelAmountCheckbox = document.getElementById('hideZeroExcelAmount');
            const txtMissingInExcelTableBody = document.querySelector('#txtMissingInExcel tbody');
            const excelMissingInTxtTableBody = document.querySelector('#excelMissingInTxt tbody');

            // 計算模態視窗的元素
            const openCalcModalBtn = document.getElementById('openCalcModalBtn');
            const closeCalcModalBtn = document.getElementById('closeCalcModalBtn'); // 用於 calcModal
            const printCalcModalBtn = document.getElementById('printCalcModalBtn'); // 列印按鈕
            const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage');

            // TXT 原始資料模態視窗的元素
            const openTxtRawModalBtn = document.getElementById('openTxtRawModalBtn');
            const closeTxtRawModalBtn = document.getElementById('closeTxtRawModalBtn');
            const exportTxtRawExcelBtn = document.getElementById('exportTxtRawExcelBtn'); // 新增匯出按鈕

            // 比對就醫日期開關：載入上次的設定；變更時儲存，已有比對結果則立即重新比對
            const compareDateToggle = document.getElementById('compareDateToggle');
            compareDateToggle.checked = loadCompareDateSetting();
            updateCompareRuleText();
            compareDateToggle.addEventListener('change', () => {
                saveCompareDateSetting(compareDateToggle.checked);
                updateCompareRuleText();
                // 「列印結果」只在比對完成後啟用、清除結果時停用，用它判斷畫面上是否有有效結果
                const hasResults = !printResultsBtn.disabled && parsedTxtRecords.length > 0 && parsedExcelRecords.length > 0;
                if (hasResults) {
                    performComparison(parsedTxtRecords, parsedExcelRecords);
                }
                if (batchState.hasResults) {
                    runBatchCompare();
                }
            });

            // 事件監聽器
            compareBtn.addEventListener('click', compareFiles);
            printResultsBtn.addEventListener('click', printResults);
            unhideAllBtn.addEventListener('click', () => unhideAllRows());

            hideZeroTxtAmountCheckbox.addEventListener('change', () => toggleRowsVisibility(txtMissingInExcelTableBody, hideZeroTxtAmountCheckbox));
            hideZeroExcelAmountCheckbox.addEventListener('change', () => toggleRowsVisibility(excelMissingInTxtTableBody, hideZeroExcelAmountCheckbox));

            txtFileInput.addEventListener('change', function() {
                updateFileList(this.files, 'txtFileList', 'txtFile');
                checkFilesAndEnableButton();
            });
            excelFileInput.addEventListener('change', function() {
                updateFileList(this.files, 'excelFileList', 'excelFile');
                checkFilesAndEnableButton();
            });

            // calcModal 的事件監聽器
            openCalcModalBtn.addEventListener('click', openCalcModal);
            closeCalcModalBtn.addEventListener('click', closeCalcModal);
            printCalcModalBtn.addEventListener('click', printCalcModal); // 列印事件監聽器
            calcDiscountPercentageInput.addEventListener('input', () => {
                saveDiscountSetting(calcDiscountPercentageInput.value);
                updateAllCalculationsForCalcModal();
            });

            // TXT 原始資料模態視窗的事件監聽器
            openTxtRawModalBtn.addEventListener('click', openTxtRawModal);
            closeTxtRawModalBtn.addEventListener('click', closeTxtRawModal);
            exportTxtRawExcelBtn.addEventListener('click', exportTxtRawTableToExcel); // 新增匯出按鈕事件監聽器

            // 點背景或按 Esc 關閉模態視窗
            const modalClosers = { calcModal: closeCalcModal, txtRawModal: closeTxtRawModal };
            Object.entries(modalClosers).forEach(([id, close]) => {
                document.getElementById(id).addEventListener('click', e => {
                    if (e.target.id === id) close();
                });
            });
            document.addEventListener('keydown', e => {
                if (e.key !== 'Escape') return;
                Object.entries(modalClosers).forEach(([id, close]) => {
                    if (document.getElementById(id).style.display === 'flex') close();
                });
            });

            /**
             * 格式化檔案大小
             * @param {number} bytes - 檔案大小（位元組）
             * @returns {string} 格式化後的檔案大小字串
             */
            function formatFileSize(bytes) {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            }

            /**
             * 更新檔案列表顯示
             * @param {FileList} files - 檔案列表
             * @param {string} listId - 顯示列表的 ID
             * @param {string} inputId - 檔案輸入框的 ID
             */
            function updateFileList(files, listId, inputId) {
                const fileListContainer = document.getElementById(listId);
                fileListContainer.innerHTML = '';

                if (files.length === 0) {
                    return;
                }

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileItem = document.createElement('div');
                    fileItem.classList.add('file-item');

                    const fileName = document.createElement('span');
                    fileName.classList.add('file-name');
                    fileName.textContent = file.name;

                    const fileSize = document.createElement('span');
                    fileSize.classList.add('file-size');
                    fileSize.textContent = formatFileSize(file.size);

                    const removeBtn = document.createElement('button');
                    removeBtn.classList.add('remove-file');
                    removeBtn.textContent = '移除';
                    removeBtn.type = 'button';
                    removeBtn.addEventListener('click', () => removeFile(i, inputId, listId));

                    fileItem.appendChild(fileName);
                    fileItem.appendChild(fileSize);
                    fileItem.appendChild(removeBtn);
                    fileListContainer.appendChild(fileItem);
                }
            }

            /**
             * 移除特定檔案
             * @param {number} index - 要移除的檔案索引
             * @param {string} inputId - 檔案輸入框的 ID
             * @param {string} listId - 顯示列表的 ID
             */
            function removeFile(index, inputId, listId) {
                const fileInput = document.getElementById(inputId);
                const dt = new DataTransfer();
                
                // 重新建立檔案列表，排除指定索引的檔案
                for (let i = 0; i < fileInput.files.length; i++) {
                    if (i !== index) {
                        dt.items.add(fileInput.files[i]);
                    }
                }
                
                // 更新檔案輸入框
                fileInput.files = dt.files;
                
                // 更新顯示列表
                updateFileList(fileInput.files, listId, inputId);
                
                // 檢查並更新按鈕狀態
                checkFilesAndEnableButton();
            }

            /**
             * 檢查檔案輸入框是否都有檔案，並啟用/禁用比對按鈕。
             */
            function checkFilesAndEnableButton() {
                const txtFiles = txtFileInput.files;
                const excelFiles = excelFileInput.files;
                
                if (txtFiles.length > 0 && excelFiles.length > 0) {
                    compareBtn.disabled = false;
                    compareBtn.classList.add('highlight-button');
                } else {
                    compareBtn.disabled = true;
                    compareBtn.classList.remove('highlight-button');
                    // 如果檔案被清除，禁用所有相關按鈕
                    printResultsBtn.disabled = true;
                    unhideAllBtn.disabled = true;
                    openCalcModalBtn.disabled = true;
                    openCalcModalBtn.classList.remove('enabled');
                    openTxtRawModalBtn.disabled = true; // 禁用 TXT 原始資料按鈕
                    clearResults(); // 清除主頁面比對結果
                }
            }
        });

        // ===================== 批次比對 (一次多家診所) =====================
        // 依檔名開頭的數字當診所代碼配對：008-1.txt、008-01.txt、011l.txt、66-1.txt (補零為 066)、
        // 008院所申報暨代檢費對帳單B.xls 都歸到同一家；同一家的多個 TXT / Excel 合併比對。

        const batchState = { files: [], groups: [], hasResults: false, runId: 0, rows: [] };

        /**
         * 國泰表下方的畫面提示 (不列印)：本表需核對的筆數 (申報金額 > 0；0 元不申報的不算)。
         * 依 2–8 月正式檔，國泰有、診所沒有的資料中約 10.8% 是上個月診所已申報。
         * @returns {string} 提示文字；沒有需核對的資料時回傳空字串。
         */
        function cathayOnlyHint(excelOnly) {
            const count = excelOnly.filter(r => r.amount > 0).length;
            return count > 0
                ? `提示：國泰有、診所沒有（申報金額大於 0）共 ${count.toLocaleString()} 筆，其中可能有部分是上個月診所已申報，可先查上月申報檔。`
                : '';
        }

        function setHint(el, text) {
            el.textContent = text;
            el.hidden = !text;
        }

        /** 檔名開頭的數字 → 3 碼診所代碼；沒有數字開頭回傳 null。 */
        function clinicCodeOf(fileName) {
            const match = fileName.match(/^(\d+)/);
            return match ? match[1].padStart(3, '0') : null;
        }

        function fileKindOf(fileName) {
            if (/\.txt$/i.test(fileName)) return 'txt';
            if (/\.xlsx?$/i.test(fileName)) return 'excel';
            return null;
        }

        /**
         * 把選取的檔案依診所代碼分組。
         * @returns {{groups: Array<{code, txt: File[], excel: File[], status, ready}>, unknown: File[]}}
         */
        function groupBatchFiles(files) {
            const byCode = new Map();
            const unknown = [];
            files.forEach(file => {
                const kind = fileKindOf(file.name);
                if (!kind) return; // .DS_Store 等非資料檔直接略過
                const code = clinicCodeOf(file.name);
                if (!code) { unknown.push(file); return; }
                if (!byCode.has(code)) byCode.set(code, { code, txt: [], excel: [] });
                byCode.get(code)[kind].push(file);
            });
            const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
            const groups = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
            groups.forEach(g => {
                g.txt.sort(byName);
                g.excel.sort(byName);
                if (g.txt.length === 0) { g.status = '缺診所 TXT，不比對'; g.ready = false; }
                else if (g.excel.length === 0) { g.status = '缺國泰 Excel，不比對'; g.ready = false; }
                else if (g.excel.length > 1) { g.status = `國泰檔有 ${g.excel.length} 個，會合併比對，請確認`; g.ready = true; }
                else { g.status = '可比對'; g.ready = true; }
            });
            return { groups, unknown };
        }

        function setBatchFiles(fileList) {
            batchState.files = [...fileList].filter(f => fileKindOf(f.name));
            const { groups, unknown } = groupBatchFiles(batchState.files);
            batchState.groups = groups;
            renderBatchGroups(groups, unknown);
            clearBatchResults();
        }

        function renderBatchGroups(groups, unknown) {
            const container = document.getElementById('batchGroups');
            container.innerHTML = '';
            if (groups.length === 0 && unknown.length === 0) {
                document.getElementById('batchCompareBtn').disabled = true;
                return;
            }
            const readyCount = groups.filter(g => g.ready).length;
            const summary = document.createElement('p');
            summary.className = 'batch-summary';
            summary.textContent = `共 ${groups.length} 家診所，${readyCount} 家可比對` + (unknown.length ? `；${unknown.length} 個檔案無法辨識代碼` : '');
            container.appendChild(summary);

            const table = document.createElement('table');
            table.className = 'batch-group-table';
            table.innerHTML = '<thead><tr><th>代碼</th><th>診所 TXT</th><th>國泰 Excel</th><th>狀態</th></tr></thead><tbody></tbody>';
            const tbody = table.querySelector('tbody');
            groups.forEach(g => {
                const row = tbody.insertRow();
                if (!g.ready) row.classList.add('batch-not-ready');
                else if (g.excel.length > 1) row.classList.add('batch-warn');
                [g.code, g.txt.map(f => f.name).join('、') || '—', g.excel.map(f => f.name).join('、') || '—', g.status]
                    .forEach(text => { row.insertCell().textContent = text; });
            });
            unknown.forEach(f => {
                const row = tbody.insertRow();
                row.classList.add('batch-not-ready');
                ['—', fileKindOf(f.name) === 'txt' ? f.name : '—', fileKindOf(f.name) === 'excel' ? f.name : '—', '檔名開頭沒有診所代碼，不比對']
                    .forEach(text => { row.insertCell().textContent = text; });
            });
            container.appendChild(table);
            document.getElementById('batchCompareBtn').disabled = readyCount === 0;
        }

        function clearBatchResults() {
            batchState.runId++; // 讓進行中的批次比對作廢
            batchState.hasResults = false;
            const results = document.getElementById('batchResults');
            results.innerHTML = '';
            results.hidden = true;
            document.getElementById('batchPrintBtn').disabled = true;
            document.getElementById('batchHealthPrintBtn').disabled = true;
            document.getElementById('batchUnhideBtn').disabled = true;
            batchState.rows = [];
        }

        /** 依序比對每一家可比對的診所，結果逐家顯示。 */
        async function runBatchCompare() {
            const groups = batchState.groups.filter(g => g.ready);
            if (groups.length === 0) return;
            // 每次比對有自己的編號：比對中途又觸發新的比對 (例如切換開關) 時，舊的那次直接作廢，
            // 結果先畫在畫面外的容器，全部完成才一次換上，避免兩次結果交錯
            const runId = ++batchState.runId;
            const compareBtn = document.getElementById('batchCompareBtn');
            compareBtn.disabled = true;
            const results = document.createElement('div');

            const overview = document.createElement('div');
            overview.className = 'batch-overview';
            results.appendChild(overview);

            const savedClinicName = clinicName; // 解析 TXT 會改寫全域的診所名稱，結束後還原給單一比對使用
            const rows = [];
            for (const group of groups) {
                try {
                    const txtRecords = [];
                    // 先讀完檔案 (await) 再解析，解析與讀取全域診所名稱之間不讓出執行權
                    const txtContents = [];
                    for (const file of group.txt) txtContents.push(await readTxtFile(file));
                    const excelContents = [];
                    for (const file of group.excel) excelContents.push(await readExcelFile(file));
                    if (runId !== batchState.runId) return; // 已有較新的比對
                    clinicName = '';
                    txtContents.forEach((content, i) => txtRecords.push(...parseTxtDataBySpaces(content, i === 0)));
                    const name = clinicName;
                    clinicName = savedClinicName;
                    const excelRecords = [];
                    excelContents.forEach(content => excelRecords.push(...parseExcelData(content)));
                    const result = computeComparison(txtRecords, excelRecords);
                    renderBatchClinic(results, group, name, txtRecords.length, excelRecords.length, result);
                    rows.push({ group, name, txtCount: txtRecords.length, excelCount: excelRecords.length, result, txtRecords });
                } catch (error) {
                    clinicName = savedClinicName;
                    console.error(`批次比對 ${group.code} 失敗:`, error);
                    rows.push({ group, error: error.message });
                    const failed = document.createElement('section');
                    failed.className = 'batch-clinic batch-error';
                    failed.id = `batch-clinic-${group.code}`;
                    failed.textContent = `${group.code}：檔案處理失敗（${error.message}）`;
                    results.appendChild(failed);
                }
            }
            if (runId !== batchState.runId) return;

            renderBatchOverview(overview, rows);
            batchState.rows = rows;
            const health = document.createElement('div');
            health.className = 'batch-health';
            overview.after(health);
            renderBatchHealth(health);
            const target = document.getElementById('batchResults');
            target.replaceChildren(...results.childNodes);
            target.hidden = false;
            updateHiddenCounts();
            batchState.hasResults = true;
            compareBtn.disabled = false;
            document.getElementById('batchPrintBtn').disabled = !rows.some(r => !r.error);
            document.getElementById('batchHealthPrintBtn').disabled = !rows.some(r => !r.error);
            document.getElementById('batchUnhideBtn').disabled = false;
            const failedCount = rows.filter(r => r.error).length;
            showMessageBox(`批次比對完成：${rows.length - failedCount} 家完成` + (failedCount ? `，${failedCount} 家失敗` : '') + '。');
        }

        function renderBatchOverview(container, rows) {
            container.innerHTML = '<h2 class="batch-overview-title">批次比對總覽</h2>';
            const table = document.createElement('table');
            table.className = 'batch-overview-table';
            table.innerHTML = '<thead><tr><th>代碼</th><th>診所</th><th>診所筆數</th><th>國泰筆數</th><th>診所有、國泰沒有</th><th>國泰有、診所沒有</th></tr></thead><tbody></tbody>';
            const tbody = table.querySelector('tbody');
            rows.forEach(r => {
                const row = tbody.insertRow();
                const codeCell = row.insertCell();
                const link = document.createElement('a');
                link.href = `#batch-clinic-${r.group.code}`;
                link.textContent = r.group.code;
                codeCell.appendChild(link);
                if (r.error) {
                    const cell = row.insertCell();
                    cell.colSpan = 5;
                    cell.textContent = `處理失敗：${r.error}`;
                    row.classList.add('batch-not-ready');
                    return;
                }
                [r.name || '（未取得名稱）', r.txtCount, r.excelCount, r.result.txtOnly.length, r.result.excelOnly.length].forEach((v, i) => {
                    const cell = row.insertCell();
                    cell.textContent = typeof v === 'number' ? v.toLocaleString() : v;
                    if (i > 0) cell.classList.add('amount-cell');
                });
            });
            container.appendChild(table);
        }

        /** 一家診所的結果：標題列 + 兩張表 (結構與單一比對相同，列印擷取共用)。 */
        function renderBatchClinic(container, group, name, txtCount, excelCount, result) {
            const section = document.createElement('section');
            section.className = 'batch-clinic';
            section.id = `batch-clinic-${group.code}`;
            section.dataset.title = name ? `${group.code} ${name}` : `診所代碼 ${group.code}`;
            section.dataset.rule = result.ruleLabel;

            const head = document.createElement('div');
            head.className = 'batch-clinic-head';
            head.innerHTML = `<span class="batch-clinic-name"></span><span class="record-count"></span>`;
            head.querySelector('.batch-clinic-name').textContent = section.dataset.title;
            head.querySelector('.record-count').textContent =
                `診所 ${txtCount} 筆（${group.txt.map(f => f.name).join('、')}）／國泰 ${excelCount} 筆（${group.excel.map(f => f.name).join('、')}）`;
            section.appendChild(head);

            const tables = [
                { title: '【診所TXT】申報對帳(診所)檔中存在，但代檢費對帳單(國泰)中不存在的資料', rows: result.txtOnly, hideZero: false, suffix: 'txt' },
                { title: '【國泰EXCEL】代檢費對帳單(國泰)中存在，但申報對帳(診所)檔中不存在的資料', rows: result.excelOnly, hideZero: true, suffix: 'excel' }
            ];
            tables.forEach(t => {
                const h2 = document.createElement('h2');
                h2.textContent = t.title;
                section.appendChild(h2);
                if (t.suffix === 'excel') {
                    const hint = document.createElement('p');
                    hint.className = 'compare-hint screen-only';
                    setHint(hint, cathayOnlyHint(t.rows));
                    section.appendChild(hint);
                }

                const checkboxId = `batch-${group.code}-hide-${t.suffix}`;
                const group0 = document.createElement('div');
                group0.className = 'hide-zero-amount-checkbox-group';
                group0.innerHTML = `<input type="checkbox" id="${checkboxId}"${t.hideZero ? ' checked' : ''}><label for="${checkboxId}">隱藏申報金額為 0 的資料<span class="hidden-count"></span></label>`;
                section.appendChild(group0);

                const table = document.createElement('table');
                table.innerHTML = '<thead><tr><th class="hide-row-checkbox-cell">隱藏</th><th>原因</th><th>病歷號碼</th><th>病患姓名</th><th>身分證</th><th>生日</th><th>檢驗日期</th><th>申報金額</th></tr></thead><tbody></tbody>';
                section.appendChild(table);

                const checkbox = group0.querySelector('input');
                const tbody = table.querySelector('tbody');
                displayResults(t.rows, tbody, checkbox);
                checkbox.addEventListener('change', () => toggleRowsVisibility(tbody, checkbox));
            });
            container.appendChild(section);
        }

        /** 批次的打折成數：沿用 localStorage 的設定 (與單一診所的計算視窗共用)。 */
        let batchDiscountPercentage = DEFAULT_DISCOUNT;

        function batchHealthRows() {
            return batchState.rows.filter(r => !r.error).map(r => ({
                code: r.group.code,
                name: r.name || '（未取得名稱）',
                ...calcHealthAmounts(r.txtRecords, batchDiscountPercentage)
            }));
        }

        /** 成健金額總表的表格 HTML (畫面與列印共用)。 */
        function batchHealthTableHtml() {
            const rows = batchHealthRows();
            const sum = key => rows.reduce((s, r) => s + r[key], 0);
            const money = v => v.toLocaleString();
            const body = rows.map(r => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td>`
                + ['total', 'filtered', 'nonFiltered', 'deduction'].map(k => `<td class="amount-cell">${money(r[k])}</td>`).join('') + '</tr>').join('');
            const totalRow = rows.length > 1
                ? `<tr class="batch-health-total"><td colspan="2">合計（${rows.length} 家）</td>`
                    + ['total', 'filtered', 'nonFiltered', 'deduction'].map(k => `<td class="amount-cell">${money(sum(k))}</td>`).join('') + '</tr>'
                : '';
            return `<table class="batch-health-table"><thead><tr><th>代碼</th><th>診所</th><th>申報總額</th><th>成健金額</th><th>非成健金額</th><th>預扣額</th></tr></thead><tbody>${body}${totalRow}</tbody></table>`;
        }

        function renderBatchHealth(container) {
            container.innerHTML = `
                <h2 class="batch-overview-title">成健金額總表</h2>
                <div class="batch-health-discount">
                    <label for="batchDiscount">打折的成數 (%)</label>
                    <input type="number" id="batchDiscount" min="0" max="100" step="0.01">
                    <span class="batch-health-note">成健＝分類 A3 且健卡序號 IC 開頭；預扣額＝非成健金額 × 打折成數</span>
                </div>
                <div class="batch-health-table-wrap"></div>`;
            const input = container.querySelector('#batchDiscount');
            const wrap = container.querySelector('.batch-health-table-wrap');
            batchDiscountPercentage = loadDiscountSetting();
            input.value = batchDiscountPercentage;
            wrap.innerHTML = batchHealthTableHtml();
            input.addEventListener('input', () => {
                batchDiscountPercentage = input.value;
                saveDiscountSetting(input.value);
                wrap.innerHTML = batchHealthTableHtml();
            });
        }

        function printBatchHealth() {
            if (!batchState.rows.some(r => !r.error)) {
                showMessageBox('沒有可列印的成健金額。');
                return;
            }
            openPrintWindow([{
                title: '成健金額總表',
                subtitle: `打折的成數: ${batchDiscountPercentage}%`,
                blocks: [`<div class="result-block">${batchHealthTableHtml()}</div>`]
            }]);
        }

        function printBatch() {
            const pages = [...document.querySelectorAll('#batchResults .batch-clinic:not(.batch-error)')].map(section => ({
                title: section.dataset.title,
                subtitle: `比對條件: ${section.dataset.rule}`,
                blocks: extractPrintBlocks(section)
            }));
            if (pages.length === 0) {
                showMessageBox('沒有可列印的比對結果。');
                return;
            }
            openPrintWindow(pages);
        }

        /** 切換「單一診所」與「批次比對」畫面。 */
        function switchMode(mode) {
            const batch = mode === 'batch';
            document.getElementById('singlePanel').hidden = batch;
            document.querySelector('.results-section').hidden = batch;
            document.getElementById('batchPanel').hidden = !batch;
            document.getElementById('batchResults').hidden = !batch || !batchState.hasResults;
            document.getElementById('modeSingle').setAttribute('aria-selected', String(!batch));
            document.getElementById('modeBatch').setAttribute('aria-selected', String(batch));
        }

        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('modeSingle').addEventListener('click', () => switchMode('single'));
            document.getElementById('modeBatch').addEventListener('click', () => switchMode('batch'));
            document.getElementById('batchFiles').addEventListener('change', e => setBatchFiles(e.target.files));
            document.getElementById('batchFolder').addEventListener('change', e => setBatchFiles(e.target.files));
            document.getElementById('batchCompareBtn').addEventListener('click', () => runBatchCompare());
            document.getElementById('batchPrintBtn').addEventListener('click', printBatch);
            document.getElementById('batchHealthPrintBtn').addEventListener('click', printBatchHealth);
            document.getElementById('batchUnhideBtn').addEventListener('click', () => unhideAllRows(document.getElementById('batchResults')));
        });
