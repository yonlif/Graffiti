document.addEventListener("contextmenu",(function(t){document.body.setAttribute("contextMenuX",t.clientX),document.body.setAttribute("contextMenuY",t.clientY)})),document.onmousemove=function(t){document.body.setAttribute("regularX",t.clientX),document.body.setAttribute("regularY",t.clientY)};