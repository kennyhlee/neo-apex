/**
 * Common JavaScript utilities for employee pages
 */

/**
 * Initialize tab navigation functionality
 * @param {Object} options - Configuration options
 * @param {string} options.tabNavSelector - Selector for tab navigation container (default: '.tab-nav')
 * @param {string} options.tabItemSelector - Selector for tab items (default: '.nav-item')
 * @param {string} options.tabPaneSelector - Selector for tab panes (default: '.tab-pane')
 * @param {string} options.tabSelectorSelector - Selector for mobile tab selector (default: '.tab-selector')
 * @param {Function} options.onTabChange - Callback function when tab changes (receives tabName)
 */
function initTabNavigation(options = {}) {
    const {
        tabNavSelector = '.tab-nav',
        tabItemSelector = '.nav-item',
        tabPaneSelector = '.tab-pane',
        tabSelectorSelector = '.tab-selector',
        onTabChange = null
    } = options;
    
    const tabNav = document.querySelector(tabNavSelector);
    const tabSelector = document.querySelector(tabSelectorSelector);
    
    if (!tabNav && !tabSelector) {
        return;
    }
    
    function showTab(tabName) {
        // Hide all tab panes
        document.querySelectorAll(tabPaneSelector).forEach(tab => {
            tab.classList.add('hidden');
        });
        
        // Show selected tab pane
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.classList.remove('hidden');
        }
        
        // Update active state in tab navigation
        if (tabNav) {
            tabNav.querySelectorAll(tabItemSelector).forEach(t => {
                if (t.dataset.tab === tabName) {
                    t.classList.add('active');
                } else {
                    t.classList.remove('active');
                }
            });
        }
        
        // Update mobile selector
        if (tabSelector) {
            tabSelector.value = tabName;
        }
        
        // Call callback if provided
        if (onTabChange && typeof onTabChange === 'function') {
            onTabChange(tabName);
        }
    }
    
    // Tab navigation click handlers
    if (tabNav) {
        tabNav.querySelectorAll(tabItemSelector).forEach(tab => {
            tab.addEventListener('click', function() {
                const tabName = this.dataset.tab;
                if (tabName) {
                    showTab(tabName);
                }
            });
        });
    }
    
    // Mobile selector change handler
    if (tabSelector) {
        tabSelector.addEventListener('change', function() {
            showTab(this.value);
        });
    }
    
    // Activate first tab by default
    if (tabNav) {
        const firstTab = tabNav.querySelector(`${tabItemSelector}:first-child`);
        if (firstTab && firstTab.dataset.tab) {
            showTab(firstTab.dataset.tab);
        }
    } else if (tabSelector && tabSelector.options.length > 0) {
        showTab(tabSelector.options[0].value);
    }
    
    return { showTab };
}

/**
 * Initialize tree navigation functionality
 * @param {Object} options - Configuration options
 * @param {string} options.toggleBtnSelector - Selector for toggle buttons (default: '.toggle-btn')
 * @param {string} options.treeNodeSelector - Selector for tree nodes (default: '.tree-node')
 * @param {Function} options.onNodeSelect - Callback function when node is selected (receives node element)
 */
function initTreeNavigation(options = {}) {
    const {
        toggleBtnSelector = '.toggle-btn',
        treeNodeSelector = '.tree-node',
        onNodeSelect = null
    } = options;
    
    // Tree structure expand/collapse functionality
    document.querySelectorAll(toggleBtnSelector).forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // Try to find Bootstrap Icon (i.bi) first, then fall back to iconify
            const icon = this.querySelector('i.bi') || this.querySelector('.iconify');
            const parentNode = this.closest(treeNodeSelector);
            
            if (!icon || !parentNode) {
                return;
            }
            
            // Find direct child nodes based on level
            let children = [];
            if (parentNode.classList.contains('level-1')) {
                // For level-1 nodes, find all direct children that have level-2 class
                children = Array.from(parentNode.children).filter(child => 
                    child.classList && child.classList.contains('level-2')
                );
            } else if (parentNode.classList.contains('level-2')) {
                // For level-2 nodes, find all direct children that have level-3 class
                children = Array.from(parentNode.children).filter(child => 
                    child.classList && child.classList.contains('level-3')
                );
            }
            
            if (children.length === 0) {
                return;
            }
            
            // Check if any children are visible
            // If style.display is 'none', it's hidden
            // If style.display === '' (empty) or not set, it's visible (default CSS display)
            const anyVisible = children.some(child => {
                const display = child.style.display || '';
                // Empty string or 'block' means visible, 'none' means hidden
                return display !== 'none' && (display === '' || display === 'block');
            });
            
            // Toggle visibility: if any are visible, hide all; otherwise show all
            const shouldHide = anyVisible;
            
            children.forEach(child => {
                child.style.display = shouldHide ? 'none' : 'block';
            });
            
            // Update icon: chevron-down when expanded (visible), chevron-right when collapsed (hidden)
            if (icon.classList && icon.classList.contains('bi')) {
                // Bootstrap Icon
                const newIconClass = shouldHide ? 'bi-chevron-right' : 'bi-chevron-down';
                // Remove existing chevron classes
                icon.classList.remove('bi-chevron-down', 'bi-chevron-right');
                // Add new chevron class
                icon.classList.add(newIconClass);
            } else if (icon.classList && icon.classList.contains('iconify')) {
                // Iconify (legacy support)
                const newIcon = shouldHide ? 'mdi:chevron-right' : 'mdi:chevron-down';
                icon.setAttribute('data-icon', newIcon);
            }
        });
    });
    
    // Node selection functionality
    // Use event delegation instead of direct listeners to handle dynamically shown/hidden nodes
    // This ensures nodes that are initially hidden (display: none) can still receive click events when shown
    // Event delegation works by attaching a listener to a parent container that exists in the DOM
    // and letting events bubble up from child elements, even if those children are dynamically shown/hidden
    
    // Use event delegation on document.body to handle all tree node clicks
    // This ensures it works even if nodes are dynamically shown/hidden
    // We store the callback in a global variable so it can be updated when initTreeNavigation is called multiple times
    
    // Store the callback in a global variable (on window) so it can be updated
    // This allows initTreeNavigation to be called multiple times with different callbacks
    window._treeNavigationCallback = onNodeSelect;
    
    // Create the event handler function that uses the global callback
    // This function will be attached to document.body only once
    function handleTreeClick(e) {
        // Find the tree container that contains this click
        const clickTreeContainer = e.target.closest('.tree-list');
        if (!clickTreeContainer) {
            return; // Click is not within a tree container
        }
        
        // Skip if clicking on toggle button (toggle button has its own handler)
        const toggleBtn = e.target.closest(toggleBtnSelector);
        if (toggleBtn) {
            return;
        }
        
        // Find the tree node that was clicked
        // Use closest() to find the nearest ancestor (or self) with the tree-node class
        // closest() will find the closest ancestor, which should be the most specific node
        let treeNode = e.target.closest(treeNodeSelector);
        
        // If closest() doesn't find anything, walk up manually
        if (!treeNode) {
            let current = e.target;
            while (current && current !== clickTreeContainer && current !== document.body) {
                if (current.classList && current.classList.contains('tree-node')) {
                    treeNode = current;
                    break;
                }
                current = current.parentElement;
            }
        }
        
        if (!treeNode) {
            return;
        }
        
        // Ensure we have the most specific (deepest nested) tree node
        // Walk from e.target up to treeNode and see if we encounter any tree nodes
        // If we do, use the one closest to e.target (most specific)
        let checkNode = e.target;
        let mostSpecificNode = treeNode;
        
        // Walk from click target up to the found tree node
        while (checkNode && checkNode !== treeNode && checkNode !== clickTreeContainer) {
            if (checkNode.classList && checkNode.classList.contains('tree-node')) {
                // Found a tree node that's closer to the click target
                // This is more specific, so use it
                mostSpecificNode = checkNode;
                break;
            }
            checkNode = checkNode.parentElement;
        }
        
        treeNode = mostSpecificNode;
        
        // Skip if clicking on a toggle button inside this node
        const nodeToggleBtn = treeNode.querySelector && treeNode.querySelector(toggleBtnSelector);
        if (nodeToggleBtn && nodeToggleBtn.contains(e.target)) {
            return;
        }
        
        // Remove active class from all tree nodes
        document.querySelectorAll(`${treeNodeSelector}.active`).forEach(el => {
            el.classList.remove('active');
        });
        
        // Add active class to clicked node
        treeNode.classList.add('active');
        
        // Get the callback from the global variable (updated by the most recent initTreeNavigation call)
        const currentCallback = window._treeNavigationCallback;
        
        // Call the callback if provided
        if (currentCallback && typeof currentCallback === 'function') {
            currentCallback(treeNode);
        }
    }
    
    // Check if handler is already attached to document.body
    // Use a data attribute to track if we've already attached the handler
    if (!document.body.hasAttribute('data-tree-nav-handler-attached')) {
        // Attach the handler to document.body using event delegation
        document.body.addEventListener('click', handleTreeClick, false);
        document.body.setAttribute('data-tree-nav-handler-attached', 'true');
    }
    // Note: The handler is only attached once, but it uses window._treeNavigationCallback
    // which is updated each time initTreeNavigation is called, so it will always use the most recent callback
}

/**
 * Initialize date selector dropdown
 * @param {Object} options - Configuration options
 * @param {string} options.selectorSelector - Selector for date selector container (default: '.date-selector')
 * @param {string} options.dropdownSelector - Selector for dropdown menu (default: '.date-dropdown')
 * @param {string} options.displaySelector - Selector for date display element (default: '.date-display')
 * @param {string} options.optionSelector - Selector for date options (default: '.date-option')
 */
function initDateSelector(options = {}) {
    const {
        selectorSelector = '.date-selector',
        dropdownSelector = '.date-dropdown',
        displaySelector = '.date-display',
        optionSelector = '.date-option'
    } = options;
    
    const dateSelector = document.querySelector(selectorSelector);
    const dateDropdown = document.querySelector(dropdownSelector);
    const dateDisplay = document.querySelector(displaySelector);
    const dateOptions = document.querySelectorAll(optionSelector);
    
    if (!dateSelector || !dateDropdown) {
        return;
    }
    
    dateSelector.addEventListener('click', function(e) {
        e.stopPropagation();
        dateDropdown.classList.toggle('active');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function() {
        dateDropdown.classList.remove('active');
    });
    
    // Select date option
    dateOptions.forEach(option => {
        option.addEventListener('click', function(e) {
            e.stopPropagation();
            const dateText = this.textContent;
            if (dateDisplay) {
                dateDisplay.textContent = dateText;
            }
            dateDropdown.classList.remove('active');
        });
    });
}

