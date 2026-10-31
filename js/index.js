
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

        /**
         * 執行兩個資料集之間的比對。
         * 找出在一個檔案中存在，但在另一個檔案中不存在的記錄。
         * @param {Array<Object>} txtRecords - 從 TXT 檔案解析的記錄。
         * @param {Array<Object>} excelRecords - 從 Excel 檔案解析的記錄。
         */
        function performComparison(txtRecords, excelRecords) {
            const txtOnly = [];
            const excelOnly = [];

            // 統一兩邊的欄位，比對與顯示都用同一個結構
            // 檢驗日期優先用正規化後的 key，無法解析時退回原始字串比對
            const toCompare = (rec, source) => source === 'txt'
                ? { id: rec.idNumber, date: rec.inspectionDateKey || rec.inspectionDate, amount: rec.amount, rec }
                : { id: rec.idCard, date: rec.inspectionDateKey || rec.inspectionDate, amount: rec.declaredAmount, rec };
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
             * @param {string} otherLabel - 對方名稱 (樓上/樓下)。
             */
            const describeMismatch = (item, others, otherLabel) => {
                if (!others || others.length === 0) return '未找到';
                const sameDate = others.filter(o => o.date === item.date);
                if (sameDate.length > 0) {
                    return `金額不符（${otherLabel} ${sameDate.map(o => o.amount).join('、')}）`;
                }
                const sameAmount = others.filter(o => o.amount === item.amount);
                if (sameAmount.length > 0) {
                    return `檢驗日期不符（${otherLabel} ${sameAmount.map(o => o.rec.inspectionDate).join('、')}）`;
                }
                return '檢驗日期及金額皆不符';
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
                    // 完全相同的資料在樓上存在，但筆數比樓下少
                    txtOnly.push(toDisplayRow(item.rec, 'txt', '重複資料（樓上筆數較少）'));
                } else {
                    txtOnly.push(toDisplayRow(item.rec, 'txt', describeMismatch(item, excelById.get(item.id), '樓上')));
                }
            }

            // 第二階段比對：從 Excel 尋找 TXT
            const txtKeys = new Set(txtItems.map(keyOf));
            for (const item of excelItems) {
                const rec = item.rec;
                const reasons = [];
                if (!txtKeys.has(keyOf(item))) {
                    reasons.push(describeMismatch(item, txtById.get(item.id), '樓下'));
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

            // 呼叫顯示結果的函式
            displayResults(txtOnly, document.querySelector('#txtMissingInExcel tbody'), document.getElementById('hideZeroTxtAmount'));
            displayResults(excelOnly, document.querySelector('#excelMissingInTxt tbody'), document.getElementById('hideZeroExcelAmount'));

            if (txtOnly.length === 0 && excelOnly.length === 0) {
                showMessageBox('比對完成！兩份文件所有身分證、檢驗日期和申報金額的資料均匹配。');
            } else if (txtOnly.length > 0 || excelOnly.length > 0) {
                showMessageBox('比對完成！請查看下方表格，找出未匹配的資料。');
            }
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
                label.appendChild(checkbox);
                checkboxCell.appendChild(label); // 將 label 添加到 td 中


                row.insertCell().textContent = record.reason;
                row.insertCell().textContent = record.medicalRecordId;
                row.insertCell().textContent = record.name;
                row.insertCell().textContent = record.idCard;
                row.insertCell().textContent = record.birthDate;
                row.insertCell().textContent = record.inspectionDate;
                const amountCell = row.insertCell();
                amountCell.textContent = record.amount.toLocaleString();
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
        }

        /**
         * 顯示所有隱藏的資料 (僅取消單獨勾選的隱藏，不影響金額為0的篩選)。
         */
        function unhideAllRows() {
            // 遍歷所有表格行，取消勾選獨立的隱藏方框並更新可見性
            const allRows = document.querySelectorAll('#txtMissingInExcel tbody tr, #excelMissingInTxt tbody tr');
            allRows.forEach(row => {
                const individualCheckbox = row.querySelector('.hide-row-checkbox');
                if (individualCheckbox) {
                    individualCheckbox.checked = false; // 取消勾選
                    row.dataset.hiddenByCheckbox = 'false'; // 重置數據屬性
                }
                // 重新評估行的可見性，根據當前「隱藏金額為0」的勾選框狀態
                const hideZeroAmountCheckboxForTable = (row.closest('table').id === 'txtMissingInExcel' ? document.getElementById('hideZeroTxtAmount') : document.getElementById('hideZeroExcelAmount'));
                updateRowVisibility(row, hideZeroAmountCheckboxForTable);
            });

            showMessageBox('所有被勾選隱藏的資料已顯示。');
        }


        /**
         * 執行列印功能。
         */
        function printResults() {
            const printWindow = window.open('', '_blank');
            printWindow.document.write('<html><head><meta charset="UTF-8"><title>比對結果列印</title>');
            printWindow.document.write('<link rel="stylesheet" href="./css/index.css">');
            printWindow.document.write('<style>');
            printWindow.document.write(`
                body { display: block; background: #fff; padding: 0; margin: 0; min-height: 0;
                       font-family: Arial, sans-serif, '微軟正黑體', 'Microsoft JhengHei'; }
                h2 { font-size: 15px; justify-content: center; text-align: center; margin: 4px 0 8px; }
                table { min-width: 0; border-radius: 0; overflow: visible; box-shadow: none; font-size: 12px; }
                table th, table td { padding: 5px 6px; }
                .page-layout, .page-layout > thead > tr > th, .page-layout > tbody > tr > td {
                    border: none; padding: 0; background: none; box-shadow: none; margin: 0; }
                .clinic-title { text-align: center; font-size: 20px; font-weight: bold; margin: 0;
                                padding: 4px 0; border-bottom: 1px solid #999; color: #000; }
                .print-time { text-align: right; font-size: 11px; color: #555; font-weight: normal; padding: 2px 0 8px; }
                .result-block { page-break-after: always; break-after: page; }
                .result-block:last-child { page-break-after: auto; break-after: auto; }
                tr { page-break-inside: avoid; break-inside: avoid; }
                thead { display: table-header-group; } /* 跨頁時重複表頭 */
                .no-match-message { display: table-cell !important; text-align: center; }
                @page { size: A4; margin: 12mm 10mm; }
            `);
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');

            // 複製結果區塊並移除不需要列印的元素
            const clonedResultsSection = document.querySelector('.results-section').cloneNode(true);
            clonedResultsSection.querySelectorAll('.hide-zero-amount-checkbox-group, .record-count, .screen-only, .hide-row-checkbox-cell, br')
                .forEach(el => el.remove());
            clonedResultsSection.querySelectorAll('tbody tr.hidden-row').forEach(row => row.remove());

            // 每個結果 (標題 + 表格) 包成一個區塊，各自獨立一頁
            const blocks = [];
            clonedResultsSection.querySelectorAll('h2').forEach(h2 => {
                const table = h2.nextElementSibling && h2.nextElementSibling.tagName === 'TABLE' ? h2.nextElementSibling : null;
                if (!table) return;
                // 隱藏後沒有任何資料列時，補上提示，避免印出空表格
                if (table.querySelectorAll('tbody tr').length === 0) {
                    table.querySelector('tbody').innerHTML = '<tr><td class="no-match-message" colspan="7">無資料</td></tr>';
                }
                blocks.push(`<div class="result-block">${h2.outerHTML}${table.outerHTML}</div>`);
            });

            // 用外層表格的 thead 放診所名稱：列印時每頁都會重複，且不會像 position:fixed 一樣蓋住內容
            const printTime = new Date().toLocaleString('zh-TW');
            const titleHtml = clinicName ? `<div class="clinic-title">${escapeHtml(clinicName)}</div>` : '';
            printWindow.document.write(`
                <table class="page-layout">
                    <thead><tr><th>${titleHtml}<div class="print-time">列印時間: ${printTime}</div></th></tr></thead>
                    <tbody><tr><td>${blocks.join('')}</td></tr></tbody>
                </table>`);
            printWindow.document.write('</body></html>');
            printWindow.document.close();
            printWindow.focus();

            // 等待內容加載完成後再列印，避免內容缺失
            printWindow.onload = function() {
                printWindow.print();
            };
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
        }

        /**
         * 顯示自定義訊息框。
         * @param {string} message - 要顯示的訊息。
         */
        function showMessageBox(message) {
            const messageBox = document.createElement('div');
            messageBox.className = 'message-box'; // 列印時隱藏
            messageBox.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: #333;
                color: white;
                padding: 20px 30px;
                border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                z-index: 1000;
                font-size: 1.1em;
                text-align: center;
                opacity: 0;
                transition: opacity 0.3s ease-in-out;
                max-width: 80%;
            `;
            messageBox.textContent = message;
            document.body.appendChild(messageBox);

            setTimeout(() => {
                messageBox.style.opacity = '1';
            }, 10);

            setTimeout(() => {
                messageBox.style.opacity = '0';
                messageBox.addEventListener('transitionend', () => messageBox.remove());
            }, 3000);
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

            // 執行金額計算顯示
            updateAllCalculationsForCalcModal();

            calcModal.style.display = 'flex';
        }

        /**
         * 關閉成健金額計算模態視窗。
         */
        function closeCalcModal() {
            document.getElementById('calcModal').style.display = 'none';
            // 關閉時重置折扣百分比
            document.getElementById('calcDiscountPercentage').value = '15';
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
                    font-family: Arial, sans-serif, '微軟正黑體', 'Microsoft JhengHei'; 
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
        function updateAllCalculationsForCalcModal() {
            const calcTotalDeclaredAmountSpan = document.getElementById('calcTotalDeclaredAmount');
            const calcFilteredAmountSpan = document.getElementById('calcFilteredAmount');
            const calcNonFilteredAmountSpan = document.getElementById('calcNonFilteredAmount');
            const calcDeductionAmountSpan = document.getElementById('calcDeductionAmount');
            const calcDiscountPercentageInput = document.getElementById('calcDiscountPercentage');

            // 申報總額：顯示未經過篩選後資料的金額總和。
            // calcTotalDeclaredAmount 已經是所有 TXT 檔案資料的總金額 (未篩選的總和)。
            calcTotalDeclaredAmountSpan.textContent = calcTotalDeclaredAmount.toLocaleString();

            // 成健金額：顯示經過篩選條件篩選後資料的金額欄位總和。
            // 篩選條件：「分類」欄位篩選為「A3」。「健卡序號」欄位篩選為以「IC」開頭的序號。
            const filteredRecords = parsedTxtRecords.filter(record => {
                const isCategoryA3 = record.category && record.category.trim().toUpperCase() === 'A3';
                const isHealthCardSerialIC = record.healthCardSerial && record.healthCardSerial.trim().toUpperCase().startsWith('IC');
                return isCategoryA3 && isHealthCardSerialIC;
            });
            const currentFilteredAmount = filteredRecords.reduce((sum, record) => sum + (record.amount || 0), 0);
            calcFilteredAmountSpan.textContent = currentFilteredAmount.toLocaleString();

            // 非成健金額：計算方式為「申報總額」減去「成健金額」。
            const nonFilteredAmount = calcTotalDeclaredAmount - currentFilteredAmount;
            calcNonFilteredAmountSpan.textContent = nonFilteredAmount.toLocaleString();

            // 預扣額：計算方式為「非成健金額」乘以可調整的「打折的成數 (%)」。
            const discount = parseFloat(calcDiscountPercentageInput.value) / 100;
            const deductionAmount = nonFilteredAmount * (isNaN(discount) ? 0 : discount);
            calcDeductionAmountSpan.textContent = deductionAmount.toLocaleString();
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
                data: col.key
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

            txtRawModal.style.display = 'flex';
        }

        /**
         * 關閉 TXT 原始資料模態視窗。
         */
        function closeTxtRawModal() {
            document.getElementById('txtRawModal').style.display = 'none';
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


            // 事件監聽器
            compareBtn.addEventListener('click', compareFiles);
            printResultsBtn.addEventListener('click', printResults);
            unhideAllBtn.addEventListener('click', unhideAllRows); // 使用修改後的 unhideAllRows 函式

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
            calcDiscountPercentageInput.addEventListener('input', updateAllCalculationsForCalcModal);

            // TXT 原始資料模態視窗的事件監聽器
            openTxtRawModalBtn.addEventListener('click', openTxtRawModal);
            closeTxtRawModalBtn.addEventListener('click', closeTxtRawModal);
            exportTxtRawExcelBtn.addEventListener('click', exportTxtRawTableToExcel); // 新增匯出按鈕事件監聽器

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