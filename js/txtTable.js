
        let dataTableInstance; // Global variable to hold the DataTable instance
        let totalDeclaredAmount = 0; // 申報總額 (總金額) - 儲存所有解析資料的總金額

        document.addEventListener('DOMContentLoaded', () => {
            const txtFileInput = document.getElementById('txtFile');
            const parseAndDisplayBtn = document.getElementById('parseAndDisplayBtn');
            const parsedDataTableBody = document.querySelector('#parsedDataTable tbody');
            const parsedDataTableHead = document.querySelector('#parsedDataTable thead');
            const recordCountSpan = document.getElementById('recordCount');

            const clearFilterBtn = document.getElementById('clearFilterBtn');
            const exportExcelBtn = document.getElementById('exportExcelBtn');

            // Calculation result elements
            const discountPercentageInput = document.getElementById('discountPercentage');
            const totalDeclaredAmountSpan = document.getElementById('totalDeclaredAmount');
            const filteredAmountSpan = document.getElementById('filteredAmount');
            const nonFilteredAmountSpan = document.getElementById('nonFilteredAmount');
            const deductionAmountSpan = document.getElementById('deductionAmount');

            let allParsedRecords = [];

            // Define column configurations based on visual positions and expected lengths
            // Headers are for display, keys are for internal data access, type for parsing/filtering
            const TXT_COLUMN_CONFIG = [
                { header: '病歷號', start: 0, length: 8, key: 'medicalRecordId', type: 'string' },
                { header: '姓名', start: 9, length: 8, key: 'name', type: 'string' },
                { header: '身份證號', start: 18, length: 10, key: 'idNumber', type: 'string' },
                { header: '性別', start: 29, length: 2, key: 'gender', type: 'string' },
                { header: '出生日期', start: 33, length: 8, key: 'birthDate', type: 'date' },
                { header: '機構代號', start: 42, length: 10, key: 'institutionCode', type: 'string' },
                { header: '科別', start: 53, length: 3, key: 'department', type: 'string' },
                { header: '就醫日期', start: 58, length: 9, key: 'visitDate', type: 'date' },
                { header: '健卡序號', start: 68, length: 4, key: 'healthCardSerial', type: 'string', filterable: true, filterType: 'multi-select' }, // 下拉式選單 (多選)
                { header: '分類', start: 73, length: 5, key: 'category', type: 'string', filterable: true, filterType: 'multi-select' }, // 下拉式選單 (多選)
                { header: '醫師代號', start: 80, length: 10, key: 'doctorID', type: 'string' },
                { header: '檢驗日期', start: 91, length: 9, key: 'inspectionDate', type: 'date' },
                { header: '點數', start: 101, length: 5, key: 'points', type: 'number' },
                { header: '成數', start: 107, length: 4, key: 'percentage', type: 'number' },
                { header: '金額', start: 111, length: 5, key: 'amount', type: 'number' }
            ];

            // Add event listeners
            parseAndDisplayBtn.addEventListener('click', parseAndDisplayTxtFile);
            clearFilterBtn.addEventListener('click', clearFilters);
            exportExcelBtn.addEventListener('click', exportTableToExcel);
            discountPercentageInput.addEventListener('input', updateAllCalculations); // Listen for changes in discount

            // Close multi-select dropdowns when clicking outside
            $(document).on('click', (event) => {
                $('.multi-select-options.show').each(function() {
                    const optionsDiv = $(this);
                    const button = optionsDiv.prev('.multi-select-button');
                    if (!button.is(event.target) && !optionsDiv.is(event.target) && optionsDiv.has(event.target).length === 0) {
                        optionsDiv.removeClass('show');
                    }
                });
            });


            /**
             * 判斷字符是否為全形字符。
             * 全形字符通常在終端或固定寬度字體中佔用兩個半形字符的空間。
             * @param {string} char - 要判斷的字符。
             * @returns {boolean} 如果是全形字符則返回 true，否則返回 false。
             */
            function isFullWidth(char) {
                const code = char.charCodeAt(0);
                return code > 255; // 中文、日文等視為全形字
            }

            /**
             * 為 String 原型添加一個方法，根據視覺寬度截取字串。
             * 全形字符佔用 2 個視覺寬度，半形字符佔用 1 個視覺寬度。
             * @param {number} startVisual - 視覺起始位置（從 0 開始）。
             * @param {number} lengthVisual - 要截取的視覺長度。
             * @returns {string} 截取後的字串。
             */
            String.prototype.substrByVisualWidth = function(startVisual, lengthVisual) {
                let result = '';
                let currentVisualWidth = 0;
                let charIndex = 0;
                const str = this;

                while (charIndex < str.length) {
                    const char = str[charIndex];
                    const charWidth = isFullWidth(char) ? 2 : 1;

                    if (currentVisualWidth + charWidth > startVisual + lengthVisual) {
                        break;
                    }

                    if (currentVisualWidth >= startVisual) {
                        result += char;
                    }

                    currentVisualWidth += charWidth;
                    charIndex++;
                }
                return result;
            };

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
                    reader.readAsText(file, 'BIG5'); // 假設 TXT 檔使用 BIG5 編碼
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
             * 解析 TXT 檔案的資料。
             * 根據預定義的視覺寬度位置截取所有欄位。
             * @param {string} data - TXT 檔案的原始字串內容。
             * @returns {Array<Object>} 解析後的資料陣列。
             */
            function parseTxtData(data) {
                const lines = data.split('\r\n');
                const records = [];
                let dataStarted = false;

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

                    // 檢查是否是診所名稱行 (例如 "謝坤川診所")
                    const potentialMedicalRecordId = line.substrByVisualWidth(TXT_COLUMN_CONFIG[0].start, TXT_COLUMN_CONFIG[0].length).trim();
                    if (!/\d/.test(potentialMedicalRecordId) && potentialMedicalRecordId.length > 0 && potentialMedicalRecordId.length < 10) {
                         console.warn('跳過可能為診所名稱或非資料行:', line);
                         continue;
                    }

                    const record = {};
                    let isValidRecord = true;

                    for (const colConfig of TXT_COLUMN_CONFIG) {
                        let value = line.substrByVisualWidth(colConfig.start, colConfig.length).trim();

                        if (colConfig.type === 'number') {
                            value = parseInt(value, 10);
                            if (isNaN(value)) {
                                console.warn(`無法解析數值欄位 ${colConfig.header}: "${value}"，設定為 0。`);
                                value = 0; // 設定為 0 或 null
                            }
                        } else if (colConfig.type === 'date') {
                            // 將日期轉換為 YYYY-MM-DD 格式，方便比較
                            value = convertDateToISO(value);
                        }
                        record[colConfig.key] = value;
                    }

                    // 簡易驗證：確保關鍵欄位不為空
                    if (!record.medicalRecordId || !record.name || !record.inspectionDate || isNaN(record.amount)) {
                        isValidRecord = false;
                        console.warn('無法解析 TXT 行中的關鍵資料，跳過此行:', line);
                    }

                    if (isValidRecord) {
                        records.push(record);
                    }
                }
                return records;
            }

            /**
             * 解析並顯示 TXT 檔案的資料。
             */
            async function parseAndDisplayTxtFile() {
                const txtFile = txtFileInput.files[0];

                if (!txtFile) {
                    showMessageBox('請先上傳 TXT 檔案。');
                    return;
                }

                clearTableAndFilters(); // 清除舊的表格內容和篩選器

                try {
                    const txtData = await readTxtFile(txtFile);
                    allParsedRecords = parseTxtData(txtData); // 解析 TXT 檔案並儲存到全域變數

                    // 計算申報總額
                    totalDeclaredAmount = allParsedRecords.reduce((sum, record) => sum + (record.amount || 0), 0);
                    totalDeclaredAmountSpan.textContent = totalDeclaredAmount.toLocaleString();

                    initializeDataTable(allParsedRecords); // 使用 DataTables 顯示資料

                    if (allParsedRecords.length > 0) {
                        showMessageBox('TXT 檔案解析完成，篩選後的資料已顯示在表格中。');
                    } else {
                        showMessageBox('TXT 檔案已解析，但未找到有效資料。請檢查檔案格式。');
                    }

                } catch (error) {
                    console.error('檔案處理錯誤:', error);
                    showMessageBox('檔案處理失敗，請檢查檔案格式或編碼是否正確。錯誤訊息: ' + error.message);
                }
            }

            /**
             * 根據解析出的資料，更新篩選器下拉選單選項。
             * @param {Array<Object>} records - 所有解析後的資料。
             * @param {string} columnKey - 欄位 key。
             */
            function populateMultiSelectOptions(records, columnKey) {
                const uniqueValues = new Set();
                records.forEach(record => {
                    if (record[columnKey]) {
                        uniqueValues.add(record[columnKey]);
                    }
                });

                const optionsDiv = document.querySelector(`.multi-select-options[data-filter-key="${columnKey}"]`);
                if (optionsDiv) {
                    optionsDiv.innerHTML = ''; // Clear previous options

                    let sortedValues = Array.from(uniqueValues);

                    // Custom sort for 'healthCardSerial': English letters first, then numbers
                    if (columnKey === 'healthCardSerial') {
                        sortedValues.sort((a, b) => {
                            const isALetter = /^[a-zA-Z]/.test(a);
                            const isBLetter = /^[a-zA-Z]/.test(b);

                            if (isALetter && !isBLetter) return -1; // a (letter) comes before b (number)
                            if (!isALetter && isBLetter) return 1;  // b (letter) comes before a (number)
                            return a.localeCompare(b); // Otherwise, sort alphabetically/numerically
                        });
                    } else {
                        // Default sort for other columns
                        sortedValues.sort();
                    }


                    sortedValues.forEach(value => {
                        const label = document.createElement('label');
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.value = value;
                        checkbox.dataset.filterKey = columnKey; // For identifying which filter it belongs to

                        // Set default checked state
                        if (columnKey === 'category' && value === 'A3') {
                            checkbox.checked = true;
                        } else if (columnKey === 'healthCardSerial' && value.startsWith('IC')) {
                            checkbox.checked = true;
                        }

                        $(checkbox).on('change', function() {
                            applyDataTablesColumnFilter(columnKey);
                        });
                        label.appendChild(checkbox);
                        label.appendChild(document.createTextNode(value));
                        optionsDiv.appendChild(label);
                    });
                }
            }

            /**
             * 初始化 DataTables 表格。
             * @param {Array<Object>} records - 要顯示的資料陣列。
             */
            function initializeDataTable(records) {
                // Destroy existing DataTable instance if it exists
                if ($.fn.DataTable.isDataTable('#parsedDataTable')) {
                    $('#parsedDataTable').DataTable().destroy();
                    parsedDataTableHead.innerHTML = '<tr></tr>'; // Reset thead to a single empty row
                    parsedDataTableBody.innerHTML = '';
                }

                const dataTableColumns = TXT_COLUMN_CONFIG.map(col => ({
                    title: col.header,
                    data: col.key // Map data to column key
                }));

                dataTableInstance = $('#parsedDataTable').DataTable({
                    data: records,
                    columns: dataTableColumns,
                    paging: false, // Disable pagination as requested
                    searching: true, // Enable global search box
                    ordering: true,
                    info: true,
                    lengthChange: false, // Hide "Show X entries" dropdown if no pagination
                    language: {
                        url: 'https://cdn.datatables.net/plug-ins/2.0.8/i18n/zh-HANT.json' // Chinese (Traditional) localization
                    },
                    // Callback function that is executed after the table has been initialized
                    initComplete: function () {
                        const api = this.api();
                        // Append a new row for filters below the main header
                        const filterRow = $('<tr>').appendTo($(api.table().header()));

                        api.columns().every(function () {
                            const column = this;
                            const colConfig = TXT_COLUMN_CONFIG[column.index()];
                            
                            // Create a new <th> for the filter input in the filter row
                            const filterCell = $('<th>').appendTo(filterRow);
                            filterCell.addClass('filter-cell'); // Apply custom styling

                            if (colConfig && colConfig.filterable && colConfig.filterType === 'multi-select') {
                                const container = document.createElement('div');
                                container.classList.add('multi-select-container');

                                const button = document.createElement('button');
                                button.classList.add('multi-select-button');
                                button.textContent = '選擇...';
                                button.type = 'button';
                                $(button).on('click', (event) => {
                                    event.stopPropagation();
                                    const optionsDiv = $(button).next('.multi-select-options');
                                    $('.multi-select-options.show').not(optionsDiv).removeClass('show');
                                    optionsDiv.toggleClass('show');
                                });

                                const optionsDiv = document.createElement('div');
                                optionsDiv.classList.add('multi-select-options');
                                optionsDiv.dataset.filterKey = colConfig.key;

                                container.appendChild(button);
                                container.appendChild(optionsDiv);
                                filterCell.append(container);

                                // Populate multi-select options (including default checks)
                                populateMultiSelectOptions(allParsedRecords, colConfig.key);
                            }
                        });

                        // After all filter elements are created and populated, apply initial filters
                        TXT_COLUMN_CONFIG.filter(col => col.filterable && col.filterType === 'multi-select').forEach(col => {
                            applyDataTablesColumnFilter(col.key);
                        });

                        recordCountSpan.textContent = `(${api.rows({ search: 'applied' }).count()} 筆資料)`;
                        updateAllCalculations(); // Initial calculation update
                    },
                    // Optional: Add a draw callback to update record count and calculations after DataTables draws
                    drawCallback: function() {
                        const api = this.api();
                        recordCountSpan.textContent = `(${api.rows({ search: 'applied' }).count()} 筆資料)`;
                        updateAllCalculations(); // Update calculations after each draw
                    }
                });
            }

            /**
             * 應用 DataTables 的列篩選。
             * @param {string} columnKey - 要篩選的欄位 key。
             */
            function applyDataTablesColumnFilter(columnKey) {
                if (!dataTableInstance) return;

                const colIndex = TXT_COLUMN_CONFIG.findIndex(col => col.key === columnKey);
                if (colIndex === -1) return;

                const selectedValues = Array.from(document.querySelectorAll(`.multi-select-options[data-filter-key="${columnKey}"] input[type="checkbox"]:checked`)).map(cb => cb.value);

                let regexString = '';
                if (selectedValues.length > 0) {
                    // Create a regex string like '^(value1|value2|value3)$' for exact match OR
                    // Or just '(value1|value2|value3)' for contains match
                    // Using '^(' + ... + ')$' for exact match of any selected value
                    regexString = '^(' + selectedValues.map(val => $.fn.dataTable.util.escapeRegex(val)).join('|') + ')$';
                }

                // Apply the search to the specific column
                // The second parameter `true` means treat as regex, third `false` means don't use smart search
                dataTableInstance.column(colIndex).search(regexString, true, false).draw();
            }

            /**
             * 更新所有金額計算結果的顯示。
             */
            function updateAllCalculations() {
                if (!dataTableInstance) {
                    // 如果沒有 DataTables 實例，則重置所有計算顯示
                    totalDeclaredAmountSpan.textContent = '0';
                    filteredAmountSpan.textContent = '0';
                    nonFilteredAmountSpan.textContent = '0';
                    deductionAmountSpan.textContent = '0';
                    return;
                }

                // 1. 申報總額 (totalDeclaredAmount) - 已在解析檔案時計算並儲存
                // totalDeclaredAmountSpan.textContent = totalDeclaredAmount.toLocaleString(); // 這裡不需要再次設定，因為它在解析時已經設定

                // 2. 成健金額 (filteredAmount) - 篩選後的金額總和
                const amountColumnIndex = TXT_COLUMN_CONFIG.findIndex(col => col.key === 'amount');
                const currentFilteredAmount = dataTableInstance.rows({ search: 'applied' }).data().reduce((sum, record) => sum + (record.amount || 0), 0);
                filteredAmountSpan.textContent = currentFilteredAmount.toLocaleString();

                // 3. 非成健金額 (nonFilteredAmount)
                const nonFilteredAmount = totalDeclaredAmount - currentFilteredAmount;
                nonFilteredAmountSpan.textContent = nonFilteredAmount.toLocaleString();

                // 4. 預扣額 (deductionAmount)
                const discount = parseFloat(discountPercentageInput.value) / 100; // 將百分比轉換為小數
                const deductionAmount = nonFilteredAmount * (isNaN(discount) ? 0 : discount);
                deductionAmountSpan.textContent = deductionAmount.toLocaleString();
            }

            /**
             * 清除所有篩選條件並重新顯示所有資料。
             */
            function clearFilters() {
                // Clear all multi-select checkboxes
                document.querySelectorAll('.multi-select-options input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = false;
                });

                // Close any open multi-select dropdowns
                document.querySelectorAll('.multi-select-options.show').forEach(optionsDiv => {
                    optionsDiv.classList.remove('show');
                });

                if (dataTableInstance) {
                    // Clear global search and all column searches
                    dataTableInstance.search('').columns().search('').draw();
                }
                showMessageBox('篩選條件已清除，顯示所有資料。');
            }

            /**
             * 匯出表格資料到 Excel 檔案。
             */
            function exportTableToExcel() {
                if (!dataTableInstance || dataTableInstance.rows().count() === 0) {
                    showMessageBox('目前沒有資料可以匯出。請先解析檔案。');
                    return;
                }

                // Get only the currently displayed (filtered) data from DataTables
                const dataToExport = dataTableInstance.rows({ search: 'applied' }).data().toArray();

                if (dataToExport.length === 0) {
                    showMessageBox('目前沒有符合篩選條件的資料可以匯出。');
                    return;
                }

                // Map the array of objects to an array of arrays for SheetJS, with headers
                const headers = TXT_COLUMN_CONFIG.map(col => col.header);
                const exportData = [headers]; // First row is headers

                dataToExport.forEach(record => {
                    const row = TXT_COLUMN_CONFIG.map(col => record[col.key]);
                    exportData.push(row);
                });

                const worksheet = XLSX.utils.aoa_to_sheet(exportData);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, "解析結果");

                const fileName = `TXT_解析結果_${new Date().toISOString().slice(0,10)}.xlsx`;
                XLSX.writeFile(workbook, fileName);

                showMessageBox('資料已成功匯出為 Excel 檔案！');
            }

            /**
             * 清除表格內容和篩選器。
             */
            function clearTableAndFilters() {
                if (dataTableInstance) {
                    dataTableInstance.destroy(); // Destroy DataTable instance
                }
                parsedDataTableHead.innerHTML = '<tr></tr>'; // Reset thead to a single empty row
                parsedDataTableBody.innerHTML = '';
                recordCountSpan.textContent = '(0 筆資料)'; // Reset count
                allParsedRecords = []; // Clear all parsed records
                totalDeclaredAmount = 0; // Reset total declared amount
                discountPercentageInput.value = '15'; // Reset discount percentage to default 15
                updateAllCalculations(); // Update all calculation displays to 0
                // Also clear multi-select options if they were populated
                TXT_COLUMN_CONFIG.filter(col => col.filterable && col.filterType === 'multi-select').forEach(col => {
                    const optionsDiv = document.querySelector(`.multi-select-options[data-filter-key="${col.key}"]`);
                    if (optionsDiv) {
                        optionsDiv.innerHTML = '';
                    }
                });
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
        });