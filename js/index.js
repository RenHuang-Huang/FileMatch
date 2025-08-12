
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
         * 將日期字符串 (YY.MM.DD 或 YYY.MM.DD) 轉換為 YYYY-MM-DD 格式。
         * @param {string} dateStr - 原始日期字符串。
         * @returns {string} 轉換後的日期字符串 (YYYY-MM-DD) 或原始字符串（如果格式不匹配）。
         */
        function convertDateToISO(dateStr) {
            const parts = dateStr.split('.');
            if (parts.length === 3) {
                let year = parseInt(parts[0], 10);
                const month = parts[1].padStart(2, '0');
                const day = parts[2].padStart(2, '0');

                // 處理民國年 (YY.MM.DD) 或西元年 (YYY.MM.DD)
                if (year < 1911) { // 假設小於1911的是民國年
                    year += 1911;
                }
                return `${year}-${month}-${day}`;
            }
            return dateStr; // 如果格式不匹配，返回原始字符串
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
            const idNumberRegex = /^[A-Z]\d{9}|[A-Z]{2}\d{8}$/i;; // 身份證號碼 (1個字母+9個數字)
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
                    row.some(cell => typeof cell === 'string' && cell.includes('申報金額'))) {
                    headerRow = row.map(cell => typeof cell === 'string' ? cell.trim() : ''); // 清理標題
                    headerRowIndex = i;
                    break;
                }
            }

            if (!headerRow) {
                throw new Error('Excel 文件中找不到包含所有必要欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 身分證, 申報金額) 的標題行。');
            }

            // 根據新的欄位名稱獲取索引
            const medicalRecordIdColIndex = headerRow.indexOf('病歷號碼');
            const nameColIndex = headerRow.indexOf('病患姓名');
            const idCardColIndex = headerRow.indexOf('身分證');
            const birthDateColIndex = headerRow.indexOf('生日');
            const inspectionDateColIndex = headerRow.indexOf('檢驗日期');
            const amountColIndex = headerRow.indexOf('申報金額');

            if (medicalRecordIdColIndex === -1 || nameColIndex === -1 ||
                birthDateColIndex === -1 || inspectionDateColIndex === -1 ||
                idCardColIndex === -1 || amountColIndex === -1) {
                throw new Error('Excel 文件缺少必要的欄位 (病歷號碼, 病患姓名, 生日, 檢驗日期, 身分證, 或 申報金額)。');
            }

            // 從標題行之後的資料行開始解析
            for (let i = headerRowIndex + 1; i < json.length; i++) {
                const row = json[i];
                if (!Array.isArray(row) || row.length === 0) continue; // 跳過空行或非陣列行

                try {
                    const medicalRecordId = (row[medicalRecordIdColIndex] || '').toString().trim();
                    const name = (row[nameColIndex] || '').toString().trim();
                    const birthDate = (row[birthDateColIndex] || '').toString().trim();
                    const inspectionDate = (row[inspectionDateColIndex] || '').toString().trim();
                    const idCard = (row[idCardColIndex] || '').toString().trim();
                    const declaredAmount = parseInt((row[amountColIndex] || '0').toString().trim(), 10);

                    if (medicalRecordId && name && birthDate && inspectionDate && idCard && !isNaN(declaredAmount)) {
                        records.push({
                            medicalRecordId: medicalRecordId,
                            name: name,
                            idCard: idCard,
                            birthDate: birthDate,
                            inspectionDate: inspectionDate,
                            declaredAmount: declaredAmount
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

            // 建立以 'id' 和 'amount' 組合為鍵的 Map，方便快速查詢，同時避免重複比對
            // 這裡我們需要一個能處理多筆相同 id + amount 記錄的結構，因此使用一個陣列來儲存
            // 建立excel map
            const excelMap = new Map();
            for (const rec of excelRecords) {
                const key = `${rec.idCard}-${rec.declaredAmount}`;
                if (!excelMap.has(key)) {
                    excelMap.set(key, []);
                }
                excelMap.get(key).push(rec);
            }

            // 第一階段比對：從 txtRecords 中尋找 excelRecords
            for (const txtRec of txtRecords) {
                const key = `${txtRec.idNumber}-${txtRec.amount}`;
                const potentialMatches = excelMap.get(key);
                if (potentialMatches && potentialMatches.length > 0) {
                    // 找到身分證-金額匹配的記錄(可能有多筆同樣的身分證和金額)
                    // 以第一個匹配到的數據，將其從 Map 中移除
                    potentialMatches.shift();
                    if (potentialMatches.length === 0) {
                        excelMap.delete(key);
                    }
                } else {
                    // 沒有找到精確匹配，現在判斷具體原因
                    let reason = '未找到';
                    // 檢查是否有身分證相符但金額不符的記錄
                    const idCardMatchExists = excelRecords.some(excelRec => excelRec.idCard === txtRec.idNumber);
                    if (idCardMatchExists) {
                        reason = '金額不符';
                    }
                    txtOnly.push({ ...txtRec, reason: reason });
                }
                
            }
            // 第二階段比對：處理 excelMap 中剩餘的記錄，這些都是獨特的記錄或金額不符的記錄
            for (const excelRec of excelRecords) {
                // 檢查此 excel 記錄是否在 txtRecords 中有完全匹配的
                const foundInTxt = txtRecords.some(txtRec => 
                    txtRec.idNumber === excelRec.idCard && txtRec.amount === excelRec.declaredAmount
                );
                if (!foundInTxt) {
                    let reason = '未找到';
                    // 檢查是否有身分證相符但金額不符的記錄
                    const idCardMatchExists = txtRecords.some(txtRec => txtRec.idNumber === excelRec.idCard);
                    if (idCardMatchExists) {
                        reason = '金額不符';
                    }
                    excelOnly.push({ ...excelRec, reason: reason });
                }
            }

            // 呼叫顯示結果的函式
            displayResults(txtOnly, document.querySelector('#txtMissingInExcel tbody'), document.getElementById('hideZeroTxtAmount'));
            displayResults(excelOnly, document.querySelector('#excelMissingInTxt tbody'), document.getElementById('hideZeroExcelAmount'));

            if (txtOnly.length === 0 && excelOnly.length === 0) {
                showMessageBox('比對完成！兩份文件所有身分證和申報金額的資料均匹配。');
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
        function displayResults(records, tableBodyElement, hideZeroAmountCheckbox) {
            tableBodyElement.innerHTML = '';

            if (records.length === 0) {
                const row = tableBodyElement.insertRow();
                const cell = row.insertCell();
                cell.colSpan = 6; // 增加一列用於勾選框
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

                // 顯示指定的欄位，TXT 記錄使用 'amount'，Excel 記錄使用 'declaredAmount'
                row.insertCell().textContent = record.reason;
                row.insertCell().textContent = record.medicalRecordId;
                row.insertCell().textContent = record.name;
                row.insertCell().textContent = record.idCard || record.idNumber; // 使用 Excel 的 idCard 或 TXT 的 idNumber
                row.insertCell().textContent = record.birthDate;
                row.insertCell().textContent = record.inspectionDate;
                row.insertCell().textContent = record.amount !== undefined ? record.amount : record.declaredAmount;


                // 為行添加數據屬性，用於追蹤狀態
                const recordAmount = record.amount !== undefined ? record.amount : record.declaredAmount;
                row.dataset.amountZero = (recordAmount === 0).toString();
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
            printWindow.document.write('<html><head><title>比對結果列印</title>');
            printWindow.document.write('<script src="./js/tailwindcss3.4.16.js"></script>');
            printWindow.document.write('<link rel="stylesheet" href="./css/index.css">');
            printWindow.document.write('<style>');
            printWindow.document.write('@media print { .clinic-title { position: fixed; top: 0; left: 0; right: 0; text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 20px; padding: 5px 0; border-bottom: 1px solid #ccc;  } }');
            printWindow.document.write('</style>');
            printWindow.document.write('</head><body>');

            

            // 創建一個臨時 div 來複製和清理 resultsSection 的內容
            const clonedResultsSection = document.querySelector('.results-section').cloneNode(true);

            // 在克隆的內容中移除不希望列印的元素
            clonedResultsSection.querySelectorAll('.hide-zero-amount-checkbox-group').forEach(el => el.remove());
            clonedResultsSection.querySelectorAll('.no-match-message').forEach(el => el.remove());
            clonedResultsSection.querySelectorAll('.record-count').forEach(el => el.remove());
            clonedResultsSection.querySelectorAll('.hide-row-checkbox-cell').forEach(el => el.remove()); // 移除獨立勾選框的單元格

            const allClonedRows = clonedResultsSection.querySelectorAll('tbody tr');
            allClonedRows.forEach(row => {
                if (row.classList.contains('hidden-row')) {
                    row.remove(); // 如果行被隱藏，則從列印內容中移除
                }
            });
            // 
            // 將清理後的內容添加到列印視窗的 body 中
            printWindow.document.write('<div class="print-area">'); // 重新添加 print-area class
            // 添加診所名稱標題
            if (clinicName) {
                printWindow.document.write(`<h1 class="clinic-title">${clinicName}</h1>`);
                printWindow.document.write('<hr style="margin-bottom: 20px;">');
            }
            printWindow.document.write(clonedResultsSection.innerHTML); // 插入清理後的內容
            printWindow.document.write('</div>');
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
            document.getElementById('compareBtn').disabled = true;
            document.getElementById('compareBtn').classList.remove('highlight-button');
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