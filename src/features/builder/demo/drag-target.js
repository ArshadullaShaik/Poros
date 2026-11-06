export function mountCanvasDragTarget(canvas) {
  // A fast release can follow dragenter before the browser sends dragover.
  for(const kind of ['dragenter','dragover'])canvas.addEventListener(kind,event=>{
    event.preventDefault();
    canvas.classList.add('drag-over');
  });
  canvas.addEventListener('dragleave',event=>{
    if(!canvas.contains(event.relatedTarget))canvas.classList.remove('drag-over');
  });
}
