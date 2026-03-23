/**
 * 共享底部栏组件
 * 使用方法：在HTML中包含此文件，然后在需要显示底部栏的地方调用 initFooter()
 */

// 底部栏配置
const footerConfig = {
    copyright: '© 2025 智慧校园管理系统 v3.2',
    support: '技术支持：信息中心',
    separator: ' | '
};

/**
 * 初始化底部栏
 * @param {Object} config - 配置对象，可以覆盖默认配置
 * @param {string} containerSelector - 容器选择器，默认为 'body'
 */
function initFooter(config = {}, containerSelector = 'body') {
    // 合并配置
    const finalConfig = { ...footerConfig, ...config };
    
    // 创建底部栏HTML
    const footerHTML = createFooterHTML(finalConfig);
    
    // 确定插入位置
    let container;
    if (containerSelector) {
        container = document.querySelector(containerSelector);
    } else {
        container = document.body;
    }
    
    if (container) {
        // 检查是否已经存在底部栏（在整个文档中）
        const existingFooter = document.querySelector('.bottom-footer');
        if (existingFooter) {
            existingFooter.remove();
        }
        
        // 如果容器是body，找到最后一个非script元素或插入到body末尾
        if (container === document.body) {
            // 找到body中最后一个非script元素
            const children = Array.from(container.children);
            const lastNonScript = children.filter(el => el.tagName !== 'SCRIPT').pop();
            
            if (lastNonScript) {
                lastNonScript.insertAdjacentHTML('afterend', footerHTML);
            } else {
                container.insertAdjacentHTML('beforeend', footerHTML);
            }
        } else {
            // 对于其他容器（如content-area），直接插入到末尾
            container.insertAdjacentHTML('beforeend', footerHTML);
        }
    }
}

/**
 * 创建底部栏HTML
 * @param {Object} config - 配置对象
 * @returns {string} 底部栏HTML字符串
 */
function createFooterHTML(config) {
    return `
<!-- 底部栏 - Bootstrap Footer -->
<footer class="bg-light border-top mt-auto py-3">
    <div class="container-fluid">
        <div class="text-center text-muted small">
            <p class="mb-0">${config.copyright}${config.separator}${config.support}</p>
        </div>
    </div>
</footer>
    `.trim();
}

// 如果DOM已加载，自动初始化（可选）
document.addEventListener('DOMContentLoaded', function() {
    // 只在没有现有footer的情况下自动初始化
    // 页面可以显式调用 initFooter() 来控制初始化时机
    if (!document.querySelector('.bottom-footer')) {
        // 不自动初始化，让页面显式调用
        // initFooter();
    }
});

