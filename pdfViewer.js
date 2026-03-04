// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.8.162/pdf.worker.min.js'

let pdfDoc = null
let totalPages = 0
let currentPage = 1
let pagesCache = {}
let hasPlaceholderImage = false

const PLACEHOLDER_IMAGE_URL = 'assets/placeholder.png'

const container = document.querySelector('.pdf_viewer')
const controls = document.querySelector('.pdf_controls')
const currentPageElement = document.querySelector('.pdf_controls-current')
const totalPagesElement = document.querySelector('.pdf_controls-total')
const prevPageButton = document.querySelector('.pdf_controls-nav[data-direction="prev"]')
const nextPageButton = document.querySelector('.pdf_controls-nav[data-direction="next"]')

function checkImageExists(url) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = url
  })
}

// Create intersection observer to detect current page
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const pageNum = Number(entry.target.dataset.pageNumber)
        currentPage = pageNum
        updatePageInfo()
      }
    })
  },
  {
    root: container,
    threshold: 0.5, // Trigger when page is 50% visible
    rootMargin: '0px',
  },
)

function createPageContainer(pageNum) {
  let pageDiv = document.createElement('div')
  pageDiv.className = 'pdf_viewer-page'
  pageDiv.dataset.pageNumber = pageNum

  // Keep page background white when placeholder image is unavailable.
  pageDiv.style.backgroundColor = 'white'
  if (hasPlaceholderImage) {
    pageDiv.style.setProperty('--page-background-image', `url("${PLACEHOLDER_IMAGE_URL}")`)
  } else {
    pageDiv.style.setProperty('--page-background-image', 'none')
  }

  observer.observe(pageDiv)

  let canvas = document.createElement('canvas')

  let annotationDiv = document.createElement('div')
  annotationDiv.className = 'pdf_viewer-annotation'

  let loadingDiv = document.createElement('div')
  loadingDiv.className = 'loading_indicator'
  loadingDiv.dataset.state = 'loading'

  // Create spinner
  let spinner = document.createElement('div')
  spinner.className = 'loading_indicator-spinner'
  spinner.dataset.position = 'absolute'

  // Create 12 bars
  for (let i = 1; i <= 12; i++) {
    let bar = document.createElement('div')
    bar.className = `loading_indicator-bar${i}`
    spinner.appendChild(bar)
  }

  loadingDiv.appendChild(spinner)

  pageDiv.appendChild(canvas)
  pageDiv.appendChild(annotationDiv)
  pageDiv.appendChild(loadingDiv)
  container.appendChild(pageDiv)

  return {
    container: pageDiv,
    canvas: canvas,
    annotationLayer: annotationDiv,
    loadingIndicator: loadingDiv,
  }
}

function renderPageContent(page, elements, pageNum) {
  // Cancel any existing render task for this page
  if (pagesCache[pageNum].renderTask) {
    pagesCache[pageNum].renderTask.cancel()
  }

  const baseViewport = page.getViewport({ scale: 1 })
  const pixelRatio = window.devicePixelRatio || 1

  const scaleX = window.innerWidth / baseViewport.width
  const scaleY = window.innerHeight / baseViewport.height
  const scale = Math.min(scaleX, scaleY)
  const viewport = page.getViewport({ scale: scale })

  elements.container.style.setProperty('--scale-factor', scale)

  elements.canvas.width = viewport.width * pixelRatio
  elements.canvas.height = viewport.height * pixelRatio
  elements.container.style.setProperty('--page-width', viewport.width + 'px')
  elements.container.style.setProperty('--page-height', viewport.height + 'px')
  elements.canvas.style.setProperty('--page-width', viewport.width + 'px')
  elements.canvas.style.setProperty('--page-height', viewport.height + 'px')

  let ctx = elements.canvas.getContext('2d')
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

  const renderTask = page.render({
    canvasContext: ctx,
    viewport: viewport,
    enableWebGL: true,
  })

  // Store the render task in pagesCache
  pagesCache[pageNum].renderTask = renderTask

  renderTask.promise
    .then(() => {
      // Clear the render task reference once complete
      pagesCache[pageNum].renderTask = null

      // Add loaded class to fade in the canvas
      elements.canvas.setAttribute('data-loaded', 'true')
      // Hide loading indicator
      elements.loadingIndicator.dataset.state = 'hidden'
      // Remove background image once canvas is loaded
      elements.container.style.setProperty('--page-background-image', 'none')

      elements.annotationLayer.style.setProperty('--page-width', viewport.width + 'px')
      elements.annotationLayer.style.setProperty('--page-height', viewport.height + 'px')
      elements.annotationLayer.innerHTML = ''

      page.getAnnotations().then((annotations) => {
        annotations.forEach((annotation) => {
          if (annotation.subtype === 'Link') {
            let linkElement = document.createElement('a')
            if (annotation.url) {
              linkElement.href = annotation.url
              linkElement.target = '_blank'
            } else if (annotation.dest) {
              linkElement.href = '#'
            }
            const rect = pdfjsLib.Util.normalizeRect(annotation.rect)
            const viewRect = viewport.convertToViewportRectangle(rect)
            const left = Math.min(viewRect[0], viewRect[2])
            const top = Math.min(viewRect[1], viewRect[3])
            const width = Math.abs(viewRect[0] - viewRect[2])
            const height = Math.abs(viewRect[1] - viewRect[3])

            linkElement.className = 'pdf_viewer-link'
            linkElement.style.setProperty('--link-left', left + 'px')
            linkElement.style.setProperty('--link-top', top + 'px')
            linkElement.style.setProperty('--link-width', width + 'px')
            linkElement.style.setProperty('--link-height', height + 'px')
            elements.annotationLayer.appendChild(linkElement)
          }
        })
      })
    })
    .catch((error) => {
      // Clear the render task reference on error
      pagesCache[pageNum].renderTask = null

      if (error instanceof pdfjsLib.RenderingCancelledException) {
        return
      }
      console.error('Error rendering page:', error)
    })
}

const PDF_URL = 'file.pdf'

// Add download button after controls initialization
function initializeControls() {
  // Create download button
  const downloadButton = document.createElement('button')
  downloadButton.className = 'pdf_controls-pill pdf_viewer-download'
  downloadButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  `
  downloadButton.title = 'Download PDF'
  controls.appendChild(downloadButton)
  const placeholder = document.createElement('div')
  placeholder.className = 'pdf_viewer-placeholder'
  controls.prepend(placeholder)

  // Add click handler for download
  downloadButton.addEventListener('click', () => {
    const link = document.createElement('a')
    link.href = PDF_URL
    link.download = PDF_URL.split('/').pop() // Get filename from URL
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    showControls() // Reset controls visibility timer
  })
}

// Initialize controls after PDF is loaded
pdfjsLib.getDocument(PDF_URL).promise.then(async (pdfDoc_) => {
  pdfDoc = pdfDoc_
  totalPages = pdfDoc.numPages
  updatePageInfo()

  hasPlaceholderImage = await checkImageExists(PLACEHOLDER_IMAGE_URL)

  // Initialize controls with download button
  // initializeControls()

  // Show controls now that we know the PDF structure
  showControlsWhenLoaded()

  for (let i = 1; i <= totalPages; i++) {
    let elements = createPageContainer(i)
    pagesCache[i] = { elements: elements, promise: pdfDoc.getPage(i) }
    pagesCache[i].promise
      .then((page) => {
        pagesCache[i].page = page
        renderPageContent(page, elements, i)
      })
      .catch((error) => {
        console.error('Error loading page ' + i, error)
      })
  }
})

prevPageButton.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--
    scrollToPage(currentPage)
    updatePageInfo()
  }
})

nextPageButton.addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage++
    scrollToPage(currentPage)
    updatePageInfo()
  }
})

let controlsTimeout = null
const CONTROLS_HIDE_DELAY = 1000 // 1 seconds

// Function to show controls and reset the timer
function showControls() {
  // Only show controls if they are loaded (PDF metadata is ready)
  if (controls.dataset.state !== 'loaded') {
    return
  }

  controls.dataset.visible = 'true'

  // Clear existing timeout
  if (controlsTimeout) {
    clearTimeout(controlsTimeout)
  }

  // Set new timeout to hide controls
  controlsTimeout = setTimeout(() => {
    controls.dataset.visible = 'false'
  }, CONTROLS_HIDE_DELAY)
}

// Show controls on mouse move
document.addEventListener('mousemove', showControls)

// Show controls on scroll
container.addEventListener('scroll', showControls)

// Add keyboard navigation
document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowLeft':
      if (currentPage > 1) {
        currentPage--
        scrollToPage(currentPage)
        updatePageInfo()
        showControls()
      }
      break

    case 'ArrowRight':
    case ' ': // Space key
      if (currentPage < totalPages) {
        currentPage++
        scrollToPage(currentPage)
        updatePageInfo()
        showControls()
      }
      // Prevent space from scrolling the page
      if (e.key === ' ') {
        e.preventDefault()
      }
      break
  }
})

// Function to show controls when PDF metadata is loaded
function showControlsWhenLoaded() {
  controls.dataset.state = 'loaded'
  // Start the auto-hide timer
  showControls()
}

function updatePageInfo() {
  currentPageElement.textContent = currentPage
  totalPagesElement.textContent = totalPages
}

function scrollToPage(pageNumber) {
  const pageElement = container.querySelector(`.pdf_viewer-page[data-page-number="${pageNumber}"]`)
  if (!pageElement) {
    return
  }

  pageElement.scrollIntoView({
    behavior: 'smooth',
    inline: 'center',
  })
}

// Initialize controls visibility - don't show initially
// Controls will be shown when PDF metadata (page count) is loaded

// Debounce function to avoid excessive re-rendering
function debounce(func, wait) {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

function handleResize() {
  // Loop through each cached page and re-render its content
  Object.keys(pagesCache).forEach((pageNum) => {
    const cacheItem = pagesCache[pageNum]
    if (cacheItem.page) {
      renderPageContent(cacheItem.page, cacheItem.elements, pageNum)
    }
  })
}

// Listen for window resize and orientation change
window.addEventListener('resize', debounce(handleResize, 300))
window.addEventListener('orientationchange', debounce(handleResize, 300))

// Controls pointer-events are managed via data-visible attribute in CSS
