/**
 * findAndReplaceDOMText v 0.4.6
 * @author James Padolsey http://james.padolsey.com
 * @license http://unlicense.org/UNLICENSE
 *
 * Matches the text of a DOM node against a regular expression
 * and replaces each match (or node-separated portions of the match)
 * in the specified element.
 */
 (function (root, factory) {
     if (typeof module === 'object' && module.exports) {
         // Node/CommonJS
         module.exports = factory();
     } else if (typeof define === 'function' && define.amd) {
         // AMD. Register as an anonymous module.
         define(factory);
     } else {
         // Browser globals
         root.findAndReplaceDOMText = factory();
     }
 }(this, function factory() {

	var PORTION_MODE_RETAIN = 'retain';
	var PORTION_MODE_FIRST = 'first';

	var doc = document;
	var hasOwn = {}.hasOwnProperty;

	function escapeRegExp(s) {
		return String(s).replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
	}

	function exposed() {
		// Try deprecated arg signature first:
		return deprecated.apply(null, arguments) || findAndReplaceDOMText.apply(null, arguments);
	}

	function deprecated(regex, node, replacement, captureGroup, elFilter) {
		if ((node && !node.nodeType) && arguments.length <= 2) {
			return false;
		}
		var isReplacementFunction = typeof replacement == 'function';

		if (isReplacementFunction) {
			replacement = (function(original) {
				return function(portion, match) {
					return original(portion.text, match.startIndex);
				};
			}(replacement));
		}

		// Awkward support for deprecated argument signature (<0.4.0)
		var instance = findAndReplaceDOMText(node, {

			find: regex,

			wrap: isReplacementFunction ? null : replacement,
			replace: isReplacementFunction ? replacement : '$' + (captureGroup || '&'),

			prepMatch: function(m, mi) {

				// Support captureGroup (a deprecated feature)

				if (!m[0]) throw 'findAndReplaceDOMText cannot handle zero-length matches';

				if (captureGroup > 0) {
					var cg = m[captureGroup];
					m.index += m[0].indexOf(cg);
					m[0] = cg;
				}

				m.endIndex = m.index + m[0].length;
				m.startIndex = m.index;
				m.index = mi;

				return m;
			},
			filterElements: elFilter
		});

		exposed.revert = function() {
			return instance.revert();
		};

		return true;
	}

	/**
	 * findAndReplaceDOMText
	 *
	 * Locates matches and replaces with replacementNode
	 *
	 * @param {Node} node Element or Text node to search within
	 * @param {RegExp} options.find The regular expression to match
	 * @param {String|Element} [options.wrap] A NodeName, or a Node to clone
	 * @param {String} [options.wrapClass] A classname to append to the wrapping element
	 * @param {String|Function} [options.replace='$&'] What to replace each match with
	 * @param {Function} [options.filterElements] A Function to be called to check whether to
	 *	process an element. (returning true = process element,
	 *	returning false = avoid element)
	 */
	function findAndReplaceDOMText(node, options) {
		return new Finder(node, options);
	}

	exposed.NON_PROSE_ELEMENTS = {
		br:1, hr:1,
		// Media / Source elements:
		script:1, style:1, img:1, video:1, audio:1, canvas:1, svg:1, map:1, object:1,
		// Input elements
		input:1, textarea:1, select:1, option:1, optgroup: 1, button:1
	};

	exposed.NON_CONTIGUOUS_PROSE_ELEMENTS = {

		// Elements that will not contain prose or block elements where we don't
		// want prose to be matches across element borders:

		// Block Elements
		address:1, article:1, aside:1, blockquote:1, dd:1, div:1,
		dl:1, fieldset:1, figcaption:1, figure:1, footer:1, form:1, h1:1, h2:1, h3:1,
		h4:1, h5:1, h6:1, header:1, hgroup:1, hr:1, main:1, nav:1, noscript:1, ol:1,
		output:1, p:1, pre:1, section:1, ul:1,
		// Other misc. elements that are not part of continuous inline prose:
		br:1, li: 1, summary: 1, dt:1, details:1, rp:1, rt:1, rtc:1,
		// Media / Source elements:
		script:1, style:1, img:1, video:1, audio:1, canvas:1, svg:1, map:1, object:1,
		// Input elements
		input:1, textarea:1, select:1, option:1, optgroup:1, button:1,
		// Table related elements:
		table:1, tbody:1, thead:1, th:1, tr:1, td:1, caption:1, col:1, tfoot:1, colgroup:1

	};

	exposed.NON_INLINE_PROSE = function(el) {
		return hasOwn.call(exposed.NON_CONTIGUOUS_PROSE_ELEMENTS, el.nodeName.toLowerCase());
	};

	// Presets accessed via `options.preset` when calling findAndReplaceDOMText():
	exposed.PRESETS = {
		prose: {
			forceContext: exposed.NON_INLINE_PROSE,
			filterElements: function(el) {
				return !hasOwn.call(exposed.NON_PROSE_ELEMENTS, el.nodeName.toLowerCase());
			}
		}
	};

	exposed.Finder = Finder;

	/**
	 * Finder -- encapsulates logic to find and replace.
	 */
	function Finder(node, options) {

		var preset = options.preset && exposed.PRESETS[options.preset];

		options.portionMode = options.portionMode || PORTION_MODE_RETAIN;

		if (preset) {
			for (var i in preset) {
				if (hasOwn.call(preset, i) && !hasOwn.call(options, i)) {
					options[i] = preset[i];
				}
			}
		}

		this.node = node;
		this.options = options;

		// Enable match-preparation method to be passed as option:
		this.prepMatch = options.prepMatch || this.prepMatch;

		this.reverts = [];

		this.matches = this.search();

		if (this.matches.length) {
			this.processMatches();
		}

	}

	Finder.prototype = {

		/**
		 * Searches for all matches that comply with the instance's 'match' option
		 */
		search: function() {

			var match;
			var matchIndex = 0;
			var offset = 0;
			var regex = this.options.find;
			var textAggregation = this.getAggregateText();
			var matches = [];
			var self = this;

			regex = typeof regex === 'string' ? RegExp(escapeRegExp(regex), 'g') : regex;

			matchAggregation(textAggregation);

			function matchAggregation(textAggregation) {
				for (var i = 0, l = textAggregation.length; i < l; ++i) {

					var text = textAggregation[i];

					if (typeof text !== 'string') {
						// Deal with nested contexts: (recursive)
						matchAggregation(text);
						continue;
					}

					if (regex.global) {
						while (match = regex.exec(text)) {
							matches.push(self.prepMatch(match, matchIndex++, offset));
						}
					} else {
						if (match = text.match(regex)) {
							matches.push(self.prepMatch(match, 0, offset));
						}
					}

					offset += text.length;
				}
			}

			return matches;

		},

		/**
		 * Prepares a single match with useful meta info:
		 */
		prepMatch: function(match, matchIndex, characterOffset) {

			if (!match[0]) {
				throw new Error('findAndReplaceDOMText cannot handle zero-length matches');
			}

			match.endIndex = characterOffset + match.index + match[0].length;
			match.startIndex = characterOffset + match.index;
			match.index = matchIndex;

			return match;
		},

		/**
		 * Gets aggregate text within subject node
		 */
		getAggregateText: function() {

			var elementFilter = this.options.filterElements;
			var forceContext = this.options.forceContext;

			return getText(this.node);

			/**
			 * Gets aggregate text of a node without resorting
			 * to broken innerText/textContent
			 */
			function getText(node) {

				if (node.nodeType === Node.TEXT_NODE) {
					return [node.data];
				}

				if (elementFilter && !elementFilter(node)) {
					return [];
				}

				var txt = [''];
				var i = 0;

				if (node = node.firstChild) do {

					if (node.nodeType === Node.TEXT_NODE) {
						txt[i] += node.data;
						continue;
					}

					var innerText = getText(node);

					if (
						forceContext &&
						node.nodeType === Node.ELEMENT_NODE &&
						(forceContext === true || forceContext(node))
					) {
						txt[++i] = innerText;
						txt[++i] = '';
					} else {
						if (typeof innerText[0] === 'string') {
							// Bridge nested text-node data so that they're
							// not considered their own contexts:
							// I.e. ['some', ['thing']] -> ['something']
							txt[i] += innerText.shift();
						}
						if (innerText.length) {
							txt[++i] = innerText;
							txt[++i] = '';
						}
					}
				} while (node = node.nextSibling);

				return txt;

			}

		},

		/**
		 * Steps through the target node, looking for matches, and
		 * calling replaceFn when a match is found.
		 */
		processMatches: function() {

			var matches = this.matches;
			var node = this.node;
			var elementFilter = this.options.filterElements;

			var startPortion,
				endPortion,
				innerPortions = [],
				curNode = node,
				match = matches.shift(),
				atIndex = 0, // i.e. nodeAtIndex
				matchIndex = 0,
				portionIndex = 0,
				doAvoidNode,
				nodeStack = [node];

			out: while (true) {

				if (curNode.nodeType === Node.TEXT_NODE) {

					if (!endPortion && curNode.length + atIndex >= match.endIndex) {
						// We've found the ending
						// (Note that, in the case of a single portion, it'll be an
						// endPortion, not a startPortion.)
						endPortion = {
							node: curNode,
							index: portionIndex++,
							text: curNode.data.substring(match.startIndex - atIndex, match.endIndex - atIndex),

							// If it's the first match (atIndex==0) we should just return 0
							indexInMatch: atIndex === 0 ? 0 : atIndex - match.startIndex,

							indexInNode: match.startIndex - atIndex,
							endIndexInNode: match.endIndex - atIndex,
							isEnd: true
						};

					} else if (startPortion) {
						// Intersecting node
						innerPortions.push({
							node: curNode,
							index: portionIndex++,
							text: curNode.data,
							indexInMatch: atIndex - match.startIndex,
							indexInNode: 0 // always zero for inner-portions
						});
					}

					if (!startPortion && curNode.length + atIndex > match.startIndex) {
						// We've found the match start
						startPortion = {
							node: curNode,
							index: portionIndex++,
							indexInMatch: 0,
							indexInNode: match.startIndex - atIndex,
							endIndexInNode: match.endIndex - atIndex,
							text: curNode.data.substring(match.startIndex - atIndex, match.endIndex - atIndex)
						};
					}

					atIndex += curNode.data.length;

				}

				doAvoidNode = curNode.nodeType === Node.ELEMENT_NODE && elementFilter && !elementFilter(curNode);

				if (startPortion && endPortion) {

					curNode = this.replaceMatch(match, startPortion, innerPortions, endPortion);

					// processMatches has to return the node that replaced the endNode
					// and then we step back so we can continue from the end of the
					// match:

					atIndex -= (endPortion.node.data.length - endPortion.endIndexInNode);

					startPortion = null;
					endPortion = null;
					innerPortions = [];
					match = matches.shift();
					portionIndex = 0;
					matchIndex++;

					if (!match) {
						break; // no more matches
					}

				} else if (
					!doAvoidNode &&
					(curNode.firstChild || curNode.nextSibling)
				) {
					// Move down or forward:
					if (curNode.firstChild) {
						nodeStack.push(curNode);
						curNode = curNode.firstChild;
					} else {
						curNode = curNode.nextSibling;
					}
					continue;
				}

				// Move forward or up:
				while (true) {
					if (curNode.nextSibling) {
						curNode = curNode.nextSibling;
						break;
					}
					curNode = nodeStack.pop();
					if (curNode === node) {
						break out;
					}
				}

			}

		},

		/**
		 * Reverts ... TODO
		 */
		revert: function() {
			// Reversion occurs backwards so as to avoid nodes subsequently
			// replaced during the matching phase (a forward process):
			for (var l = this.reverts.length; l--;) {
				this.reverts[l]();
			}
			this.reverts = [];
		},

		prepareReplacementString: function(string, portion, match) {
			var portionMode = this.options.portionMode;
			if (
				portionMode === PORTION_MODE_FIRST &&
				portion.indexInMatch > 0
			) {
				return '';
			}
			string = string.replace(/\$(\d+|&|`|')/g, function($0, t) {
				var replacement;
				switch(t) {
					case '&':
						replacement = match[0];
						break;
					case '`':
						replacement = match.input.substring(0, match.startIndex);
						break;
					case '\'':
						replacement = match.input.substring(match.endIndex);
						break;
					default:
						replacement = match[+t] || '';
				}
				return replacement;
			});

			if (portionMode === PORTION_MODE_FIRST) {
				return string;
			}

			if (portion.isEnd) {
				return string.substring(portion.indexInMatch);
			}

			return string.substring(portion.indexInMatch, portion.indexInMatch + portion.text.length);
		},

		getPortionReplacementNode: function(portion, match) {

			var replacement = this.options.replace || '$&';
			var wrapper = this.options.wrap;
			var wrapperClass = this.options.wrapClass;

			if (wrapper && wrapper.nodeType) {
				// Wrapper has been provided as a stencil-node for us to clone:
				var clone = doc.createElement('div');
				clone.innerHTML = wrapper.outerHTML || new XMLSerializer().serializeToString(wrapper);
				wrapper = clone.firstChild;
			}

			if (typeof replacement == 'function') {
				replacement = replacement(portion, match);
				if (replacement && replacement.nodeType) {
					return replacement;
				}
				return doc.createTextNode(String(replacement));
			}

			var el = typeof wrapper == 'string' ? doc.createElement(wrapper) : wrapper;

 			if (el && wrapperClass) {
				el.className = wrapperClass;
			}

			replacement = doc.createTextNode(
				this.prepareReplacementString(
					replacement, portion, match
				)
			);

			if (!replacement.data) {
				return replacement;
			}

			if (!el) {
				return replacement;
			}

			el.appendChild(replacement);

			return el;
		},

		replaceMatch: function(match, startPortion, innerPortions, endPortion) {

			var matchStartNode = startPortion.node;
			var matchEndNode = endPortion.node;

			var precedingTextNode;
			var followingTextNode;

			if (matchStartNode === matchEndNode) {

				var node = matchStartNode;

				if (startPortion.indexInNode > 0) {
					// Add `before` text node (before the match)
					precedingTextNode = doc.createTextNode(node.data.substring(0, startPortion.indexInNode));
					node.parentNode.insertBefore(precedingTextNode, node);
				}

				// Create the replacement node:
				var newNode = this.getPortionReplacementNode(
					endPortion,
					match
				);

				node.parentNode.insertBefore(newNode, node);

				if (endPortion.endIndexInNode < node.length) { // ?????
					// Add `after` text node (after the match)
					followingTextNode = doc.createTextNode(node.data.substring(endPortion.endIndexInNode));
					node.parentNode.insertBefore(followingTextNode, node);
				}

				node.parentNode.removeChild(node);

				this.reverts.push(function() {
					if (precedingTextNode === newNode.previousSibling) {
						precedingTextNode.parentNode.removeChild(precedingTextNode);
					}
					if (followingTextNode === newNode.nextSibling) {
						followingTextNode.parentNode.removeChild(followingTextNode);
					}
					newNode.parentNode.replaceChild(node, newNode);
				});

				return newNode;

			} else {
				// Replace matchStartNode -> [innerMatchNodes...] -> matchEndNode (in that order)


				precedingTextNode = doc.createTextNode(
					matchStartNode.data.substring(0, startPortion.indexInNode)
				);

				followingTextNode = doc.createTextNode(
					matchEndNode.data.substring(endPortion.endIndexInNode)
				);

				var firstNode = this.getPortionReplacementNode(
					startPortion,
					match
				);

				var innerNodes = [];

				for (var i = 0, l = innerPortions.length; i < l; ++i) {
					var portion = innerPortions[i];
					var innerNode = this.getPortionReplacementNode(
						portion,
						match
					);
					portion.node.parentNode.replaceChild(innerNode, portion.node);
					this.reverts.push((function(portion, innerNode) {
						return function() {
							innerNode.parentNode.replaceChild(portion.node, innerNode);
						};
					}(portion, innerNode)));
					innerNodes.push(innerNode);
				}

				var lastNode = this.getPortionReplacementNode(
					endPortion,
					match
				);

				matchStartNode.parentNode.insertBefore(precedingTextNode, matchStartNode);
				matchStartNode.parentNode.insertBefore(firstNode, matchStartNode);
				matchStartNode.parentNode.removeChild(matchStartNode);

				matchEndNode.parentNode.insertBefore(lastNode, matchEndNode);
				matchEndNode.parentNode.insertBefore(followingTextNode, matchEndNode);
				matchEndNode.parentNode.removeChild(matchEndNode);

				this.reverts.push(function() {
					precedingTextNode.parentNode.removeChild(precedingTextNode);
					firstNode.parentNode.replaceChild(matchStartNode, firstNode);
					followingTextNode.parentNode.removeChild(followingTextNode);
					lastNode.parentNode.replaceChild(matchEndNode, lastNode);
				});

				return lastNode;
			}
		}

	};

	return exposed;

}));


findAndReplaceDOMText(document.body, {
  find: 'TUCANTHAY',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' different ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' get ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' know ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' am ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' As ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' However, ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' like ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' up ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' could ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' some ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' When ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' should ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grammar ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' many ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' practice ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' them ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' first ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' his ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' listening ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' one ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' This ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' – ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' time ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' common ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' so ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' which ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' but ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' from ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' make ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' people ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' want ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' has ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' use ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' very ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' most ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' language. ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speak ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' learn ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' just ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' was ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' - ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' word ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' how ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' need ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' their ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' what ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' It ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' would ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' an ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' he ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' about ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' my ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' by ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' if ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' If ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' You ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' we ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' they ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' at ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' learning ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' The ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' new ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' when ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' more ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' In ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' words ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' do ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' on ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' language ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' for ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' as ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' or ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' with ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' this ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' be ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' can ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' will ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' not ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' are ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' have ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' it ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' I ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' your ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' that ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' is ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' of ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' in ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' and ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' a ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' you ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' to ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' the ',
  wrap: 'span',
  wrapClass: 'shiny'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1- ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 101 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 102 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 103 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 104 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 106 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 107 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 109 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 110 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 111 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 112 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 113 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 114 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 115 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 116 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 117 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 118 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 119 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 12 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 120 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 121 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 122 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 123 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1257 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 13 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 130 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 13374 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 14 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 168 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 17 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 18 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 19 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1980s ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1990 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1999 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 200 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2003 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 21 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 22 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 225 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 23 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 25 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2500 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 25508 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 26 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 27 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 28 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 29 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2925 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2-hour ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 31 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 32 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 33 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 34 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 36 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 362 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 37 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 38 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 39 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 40 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 41 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 42 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 43 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 44 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 45 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 46 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 47 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 48 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 49 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 51 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 52 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 524 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 53 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 54 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 55 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 57 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 58 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 5kg-weights ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 600 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 61 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 62 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 63 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 64 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 65 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 66 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 67 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 68 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 69 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 70 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 700 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 71 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 72 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 73 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 74 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 7444 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 77 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 79 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 80 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 81 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 82 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 83 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 84 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 85 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 86 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 87 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 88 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 89 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 90 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 91 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 92 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 93 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 95 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 96 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 97 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 978-0-578-06697-4 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 98 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 99 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Absolutely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' absorbed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' academic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' accelerated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' accumulating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Acquire ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' acquired ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' active ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' activities ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' activity ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' additional ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adjustment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adoption ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adult ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adults ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' affected ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Africa ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' afterward ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Agency3 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aggressively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ago ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' alarm ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' All ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' allows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' alone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aloud ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' alternate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' amazingly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Amazon ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' America ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' AMIDON ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Amount ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' analyze ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' analyzed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Anatomy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ANGELOU ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' answering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' answers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' anxiety ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' anyone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' anytime ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' anywhere ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' appearance ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' approaches ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' appropriately ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Are ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' areas ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' argue ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' arguments ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' arrangements ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' arranging ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' asks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' asleep ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Aspect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aspects ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' assigned ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' assumed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' assumes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' athletes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attach ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attempting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attracted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attributes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attributive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' August ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' automatic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' auto-rewind ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ave ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' average ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bank ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Bank ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Barns ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Baroque ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bars ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' base ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Be ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' beautiful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' becoming ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' begins ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' belief ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' beliefs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' believing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bend ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' beneficial ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bicycle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bigger ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' billion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bolds ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bookstore ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' boosts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' border ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bothersome ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' boyfriend ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Brain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' breath ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Brian ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' briefly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bringing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' brokers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bugs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' built ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bundle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' business-plan ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' C ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Cameron ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' career ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Carolyn ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' categorized ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' category ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' causes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' CD ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Census ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' challenged ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' champion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Chances ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' changing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' channel ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chatting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cheap ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' choosing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chosen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chunks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' city ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clarifies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clarify ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' classes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clients ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clip ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' closer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Cloud ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clubs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' CNBC ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' coauthored ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' collected ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' combination ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comfortably ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Coming ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' commented ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Common ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' community ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compares ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compelled ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' competitors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' complaints ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' complete ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' completed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' complex ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' complexity ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compliment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compliments ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Comprehend ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' concentrated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conclude ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conducted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conference ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' confident ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' CONFUCIUS ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' confused ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' connection ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conquer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conscious ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consciousness ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consider ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consolidate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' constitutes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consulting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consuming ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' contained ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' containing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conTENT ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Content ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' CONtent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Contents ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Context ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' contexts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Continue ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' continuing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' continuous ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' contractors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' controlling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Cooper ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cope ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Copyright ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' corner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' costly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' counted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' counterparts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' countries ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Craig ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' crashes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' creativity ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' credibility ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' criticism ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' critique ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' crystal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cup ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Cup ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' current ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' customer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cuts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' CV ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Czech ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' damages ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dancers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dare ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' datum ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' David ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' de- ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' death ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' debts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' decided ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' decides ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' decision ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Dedication ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' deep ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' deeper ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' definite ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' delayed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' deliver ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' demonstrates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' depends ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' depth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' describing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' desk ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' detail ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' determined ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' determines ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Deutsch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Deutsche ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' developer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' development ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' devoted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' diameter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dictionaries ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Different ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' digest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' digital ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' disciplined ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discovering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dishonest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dismiss ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dismissed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' disorder ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' distracted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' distraction ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' distribution ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' distributional ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' divided ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' DO ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' doctor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' document ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Doing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' doubt ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' DOUGLASS ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drafting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drag ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drawback ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dreamed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dreams ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' driven ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drives ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dumper ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' e- ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' earlier ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' easiest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' economic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' economist ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Edelman ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' EDWIN ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' effects ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' efficiently ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' EIGHT ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Either ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' elbows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' element ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' e-mail ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' emerge ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Emergent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' emerging ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Emerson ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' emphasis ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' emphasize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' employ ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' employee ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' encourages ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' English-filled ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enjoy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enrich ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' entering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enthusiasm ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' entirely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' entrepreneurship ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' entries ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' entry ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' equivalent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' erase ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' event ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' everybody ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Everyone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' evidence ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exaggerating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Except ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exciting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' excuses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exercise ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' existence ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Expatriates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expected ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' experiences ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' experiment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expert ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' explained ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Explaining ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exploring ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expressing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Eye ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' faced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' face-to-face ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' failing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fails ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' failures ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fall ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fallen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fan ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' FAQ ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' faster ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fastest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' father ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' favors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' features ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' feels ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fell ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Fiction ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' final ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' FINAL ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finally ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finance ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finds ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fine-tune ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finger ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finished ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Fiore ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' firm ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' First ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' FIVE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' flexible ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' floor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' flows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fluent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' focuses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' follows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fooled ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' football ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forces ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forcing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' FORD ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Foreigners ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Forget ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forms ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' formulas ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' foundation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' foundational ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' FOUR ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Frank ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' FREDERICK ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' freezes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' French ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frequencies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Friends ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frightened ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' From ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frustrate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frustrated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frustrates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fumble ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fumbling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gaining ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gap ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Gather ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gave ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gears ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' George ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Gerald ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Getting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' given ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' global ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Good ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' goodwill ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Google ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' go-to ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grabbing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grade ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Grammar ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grammatical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' groups ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grown ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' growth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Guess ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' guidebook ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' H ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' half- ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Half ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' handed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' handy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happening ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happiness ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hardest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Having ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' headache ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' headline ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' health ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' helping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' HENRY ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Her ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hesitant ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hesitate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hide ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hint ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hire ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' history ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' History ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hobbyist ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hole ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' homes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' honest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' household ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Human ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hundreds ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Hung ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' HUNG ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hunger ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' identity ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' idiom ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' idle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' IELTS ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ignoring ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' illustrates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' illustration ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' illustrations ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' immerse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Immerse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' imperfect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' improved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' inches ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' included ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' income ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' incorrect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' increased ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' indefinite ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Indian ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Indians ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' indicates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' indication ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' inefficient ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' infants ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' infinitive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' influential ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' infrastructure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Ingredient ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' initial ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' initiates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' inject ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' inputs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' insisted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Instead ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' instructor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intelligent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intending ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intensively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intensiveness ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interact ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interaction ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interests ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interferes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intersections ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' introduce ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' invent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' investment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' IQ ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' irritating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ISBN ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' isolating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Italian ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' journal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' journey ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' judgement ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' JUST ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Keep ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' keeps ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' kid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Kids ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Know ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' labor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lack ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lacked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lacks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' LAND ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lands ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' LANGUAGE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' LAO ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' late ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Latin ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' latter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' launch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lead ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' leading ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' leaking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' leaner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Learners ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' leave ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lectures ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lifting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' LIKE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' liked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' limit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Linda ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' LINDA ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lines ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lips ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' listener ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' litmus ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' live ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Living ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lki ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' located ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' logic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' logical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Long ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Look ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' loudly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' love ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' loved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' low ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lucky ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Macintosh ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' magic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mahout ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mail ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' maintain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' major ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' majority ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' majors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' manual ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' MARK ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' marketplace ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mass ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mastery ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' math ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mathematical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' MAYA ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mayor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meaningful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meant ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' measures ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' melody ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' member ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' members ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Members ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' memorized ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mention ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' messy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meters ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' methodology ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Mexico ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' microphone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' middle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' miles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' minority ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' miracle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' missed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' missing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mix ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mode ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' modified ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' moment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' momentum ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mortgage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' motivated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' motivates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' motorbike ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' moved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' movements ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' moves ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Moving ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' multi-cultural ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' myths ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Myths ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' nan ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' nancial ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' natively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Nature ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ne ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' near ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' necessarily ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' needed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' negatively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' negotiating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' neighbor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' NEW ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' newspapers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ng ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' nice ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' nine ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' NINE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ninth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Nobel ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' non-stressed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' North ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Not ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' NOT ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Number ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' O ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' objects ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' obscure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' observing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Observing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' obvious ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' occur ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' occurs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' offices ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' on-demand ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ONE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' opening ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' opinions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' opportunities ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' opt ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ordinary ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' organize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' organizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' original ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outsourcing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outstanding ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Over ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' overlooked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' overseas ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' owned ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' owners ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' PABLO ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pages ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' paid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pair ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' paper ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' paragraphs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' parallel ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' particularly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' partner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pass ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' passionate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pause ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pave ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pay ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' peaking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' People ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' perform ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' permission ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Pham ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' PHAM ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Philosophy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Photoshop ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' physical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' PICASSO ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' picking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' PIERCE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Pimsleur ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' placed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' placement ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' plans ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' played ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' playful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' points ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' polishing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' politicians ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' popped ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pops ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' portion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' position ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' possibility ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' posted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' posts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Practicing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' precisely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' precludes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' predicts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prefer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' preferably ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' preposition ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prescription ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' presents ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' president ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prevents ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pricing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Printed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' priority ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' private ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' private-sector ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Prize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Proactively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prob ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' processes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' procrastination ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' profitable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' profoundly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' programmer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' projects ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronouns ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' properties ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proposals ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' provides ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' providing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proving ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' psychological ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' published ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Published ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Publishing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' push ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Put ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Putting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' puzzle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quaint ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Quang ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' questioning ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quick ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quickest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' r ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' radio ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Rajesh ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Ralph ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rambling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rank ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ranked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rankings ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reach ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reached ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ready ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' realizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reasonable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Recall ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' received ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' receiving ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Recognize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recognizes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reflected ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' refrain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' regular ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' regularly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rehearse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reinforces ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' relatively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Relax ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' relaxation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' relaxed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Religion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' remain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' remaining ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reminds ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' remote ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' remove ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Remove ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' renowned ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' REPEAT ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' repetitive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rephrase ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' replaced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' replies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' report ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reporter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reports ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reproduced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' request ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' require ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' researched ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' residence ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' responsible ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' restricted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Results ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' retained ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' return ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' revelation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' revenues ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reverse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reward ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rights ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rise ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' robbing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' robe ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rode ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rope ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ropes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rubbish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rule ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Russian ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' s ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' S ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' satellite ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' satisfied ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' satisfy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' saw ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' scattering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' scholars ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' science ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Science ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' scratch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Screening ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seamlessly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' searching ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Second ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sectors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' See ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' self ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Self ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' self-employed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sells ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' senses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' serves ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' services ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sessions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sets ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' setting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seven ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' SEVEN ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Shakespeare ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sharply ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shift ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Shifting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shine ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shocked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shortly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Should ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shovel ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shown ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sign ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' significance ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' silly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Singaporian ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' situations ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' SIX ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' size ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sizes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skimp ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skipping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skips ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skyrocket ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sleeping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slew ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slide ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slides ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sliding ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slightly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slope ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slowly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' smartphones ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Smile ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' smoothly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' soldier ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' soldiers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' solid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Someone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sophisticatedly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sort ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sorting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sorts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Sound-mapping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Sound-Mapping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' South ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sparkle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' SPEAK ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speeches ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speed-reduced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spill ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sponsored ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spot ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spots ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spread ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' staff ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stand ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' standing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Starting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' statements ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' statistical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' statistics ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' staying ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stays ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' step-by-step ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stepping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Steps ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' STEPS ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stiff ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stimulate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stock ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stood ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stopped ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' store ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Stories ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' storytelling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' straight ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strategic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strategies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strategist ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' street ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strengths ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stress-free ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strongly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' student ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Students ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' styles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sub- ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' successful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' successfully ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suffered ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suggested ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suggesting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suggests ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suitable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' super ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' supplementary ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' supposed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' surprisingly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' surrounded ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' switch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' symbol ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' synonyms ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' T ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' taken ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Talk ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' talks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tasks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' taxi ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Teacher ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' telecommuting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' teleconference ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' telephone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Tell ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' temporary ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ten ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' TEN ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tenses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' test ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' textbook ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thank ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thanks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Thanks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Their ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' themselves ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' theory ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thin ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thoughts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' THOUGHTS ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thousands ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Three ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' THREE ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thrilled ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' throughout ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' throw ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Thu ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tie ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tied ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Time ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' timing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tips ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' TO ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Together ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tolerant ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tons ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Tony ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Topic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tops ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' touchstone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tourists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' towards ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' trace ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' track ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Trade ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' trading ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' train ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Translate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' translates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' translating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' translation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' transmitted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' trends ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' trouble ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' truth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' turn ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' TWO ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Tzu ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' TZU ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' U ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Underline ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' underlining ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' understandable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' undisputable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Unfocused ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unintelligent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unique ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unless ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unreal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' updating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' up-to-date ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' utilizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vanish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' variants ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vary ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' venture ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' verbal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' victory ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Video ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Vietnamese-American ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' view ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' viewing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Vilfredo ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' virtual ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visible ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visited ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visual ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visualization ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Visualization ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visualizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vital ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Vital ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vivid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vocal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' volume ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vouch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wa ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Waking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Waldo ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' warm-up ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wasting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Watch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' watched ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' weaknesses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' weather ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' webcam ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Week ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' welcomes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' well-spent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' well-thought-out ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' whenever ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' whom ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' widely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Will ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Windows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' winning ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wished ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wishes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Without ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wonder ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' worked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' workers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' worst ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' writers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wrongly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' x ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Yahoo ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' year ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' young ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' yours ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' zero-based ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Zipf ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 105 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 108 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1500 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 16 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2010 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 24 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 35 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 35-year-old ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 50th ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 56 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 59 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 5-stage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 75 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 76 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 78 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 8 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 9 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 94 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Academic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Accelerate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' accepting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Acquiring ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' act ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adapt ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adding ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Administration ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' advantages ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' afford ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' against ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aiming ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' allowed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' An ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Any ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' appeared ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' appears ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' applied ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' applies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' approximately ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' arranged ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' art ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' asking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aspect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' assist ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' associates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Audio ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' automatically ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' avoid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' badly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bag ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' basis ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' BBC ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' became ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' beginner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' behind ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' birthday ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' black ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' blank ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' blog ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' blurred ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Books ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' boring ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' born ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' borrowed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bought ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' box ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' buy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' calm ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' came ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' care ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cash ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' character ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' charts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chauffeur-driven ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chess ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' choice ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' choose ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clearer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' climb ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' combinations ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' commercial ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' communicating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' communication ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comparing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' competitive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compose ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' concern ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' confidence ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' confidently ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' confusing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consciously ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' contains ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' contract ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conversation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' coordinating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' count ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' course ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cover ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' created ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' criticize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cycle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' decreases ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dedicated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' deeply ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' define ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' delay ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' depending ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Depending ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' description ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' differentiate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' difficulty ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dig ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' digesting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' direct ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' disappear ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discipline ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discovered ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discussed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' disputes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' distinguish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' divorced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Does ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' double ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drawing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drink ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' driving ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' duchess ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Due ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Duke ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' edit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' elephants ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' else ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' embarrassment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' emotion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' employees ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enjoying ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' errors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' essence ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' essential ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' estimated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' evening ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ex ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' examples ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' excite ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expatriates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expensive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' experienced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expertise ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expired ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' explore ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expose ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exposure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expressed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' extremely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' f ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' faces ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' facing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' failed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' failure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' famous ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fee ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fewer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' findings ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finishing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' five ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fix ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fixed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' focusing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' followed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fourth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' framework ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frequently ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' friendship ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' full ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fun ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' function ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' games ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grab ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gradually ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Great ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' greater ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' grow ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' habit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' handwritten ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hang ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happiest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hard-earned ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Harry ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hauls ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' head ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' headquarters ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hearing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' heavy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hired ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' His ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hold ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hoping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' humans ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hundred ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' identify ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Imagine ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Imitate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' impatient ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' incorrectly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' increase ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' increases ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' increasing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' inside ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' instructions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' integrate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intention ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intentionally ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interactive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Intonation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' introduced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' introducing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' issue ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Its ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' journalist ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' judge ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' jump ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Kaufmann ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lavish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Learner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Leaving ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' legs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' letters ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Like ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' limited ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lives ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' London ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' losing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lower ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mahouts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' management ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' marks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' marry ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mastering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' maximize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meanings ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Mechanism ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Memorizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' memory ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' merely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mimic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' minor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' minute ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' miss ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mistake ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mistakes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' moments ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' morning ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' motivate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' movies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Movies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mutual ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' n ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' named ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Natural ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' needs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Network ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' night ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' nor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' notes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' notice ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' obstacle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' offer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' older ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Online ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Open ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' operations ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' opinion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' optimize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' options ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' painful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' particular ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' partners ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' party ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' per ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' percentage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' perfection ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' persons ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' philosophy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pile ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Pinson ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pitch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' place ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Plan ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' playing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' plays ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' plenty ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' poems ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' police ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' polish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' poor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pop ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pose ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' posing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' positions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' possess ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Potter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pounds ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' poured ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' power ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' practical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' preferred ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' preliminary ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prepare ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prepared ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pressure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prevent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Principle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' print ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' printed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' produced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' product ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' products ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proficient ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proficiently ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' promotional ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronouncing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' provide ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' public ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quality ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' raise ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' raises ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ranking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rarely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reality ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' realizes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recalling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recommend ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recommended ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Record ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recording ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' referred ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reinforce ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reluctant ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Remember ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' remembering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' repeats ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reply ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' represent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' representative ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' required ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Research ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reveals ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' revenue ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rewind ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rhythm ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' riding ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Robert ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' room ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rough ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' royal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' runs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' samples ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' saved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' scale ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' school ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' School ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' scientific ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Scientists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seek ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seemed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Select ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' selected ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Selecting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' selective ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sell ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' separate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' series ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' service ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shape ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shorten ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' short-term ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' side ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' simplify ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Simply ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Singaporians ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Skills ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skull ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slip ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' smiling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Smith ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Solutions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' somewhat ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' son ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' song ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sophisticated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' special ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' specifically ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spell ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' split ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' squeeze ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Start ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' statement ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' States ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stayed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Stephen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stick ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Stress ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stresses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strokes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' struggle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' struggling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' studied ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' study ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stuffed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' subconscious ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' subjects ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Success ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suddenly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Sun ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' surprised ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' survey ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' swanky ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' system ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' t ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tabloid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' taking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tapes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' task ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' teaching ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Techniques ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' technology ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' television ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' telling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thinks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Those ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' throws ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' timer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Times ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' title ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' today ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' TOEFL ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Tool ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' topics ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' totally ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' traces ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' transfer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' travel ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' UK ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unavailable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unclear ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' undercover ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' underneath ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' United ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' University ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Unlike ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' updated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' usage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' varies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' variety ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' varying ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ventures ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' versions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' via ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vice ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' videos ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Viewing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visitors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visualize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Vocabulary ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vowel ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wait ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' walking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wanted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' weakest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' weapon ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Web ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Whether ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Who ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' whose ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wide ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wife ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' willing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' window ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wire ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wondered ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wondering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' workload ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' World ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Write ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' writes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 11 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 3-step ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ability ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' achieved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' acquisition ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' across ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' action ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' acts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' adjust ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' advanced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' amazing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' appear ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' arrange ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' arrival ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aside ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Ask ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attempted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attention ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attract ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' available ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' avoided ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' awkward ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' baroque ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' basically ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' becomes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Being ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' below ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' benefits ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bottom ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' brings ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' British ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' brought ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Build ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bunch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cause ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cells ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' certainly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' changed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' charity ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' checked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' circle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clause ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' closely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' collect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compare ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compared ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' compelling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comprehensive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' concentrate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' concerned ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' confuse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' considered ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' coordinate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Core ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' correcting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' correctly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' courses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' creates ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' decide ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' defeat ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' designed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' directly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discover ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discussing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dramatically ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' draw ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dream ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' drive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' e ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' effectiveness ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' efficient ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' energy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enterprises ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' especially ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exact ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exchange ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' excitement ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exist ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' expedite ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' explaining ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' explains ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exploit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' extreme ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' feet ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Fergie ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' field ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fifth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' film ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' filmed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finding ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fingerprint ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Foreign ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' foreigner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' foreigners ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' former ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' goals ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' guess ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' guide ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' guy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' handwriting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happened ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Hollywood ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' honoured ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hope ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hour ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hours ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' illustrated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' immediately ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' include ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' including ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' individual ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' involved ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' joined ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' King ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' known ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' left ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' listed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Listening ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' long-term ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lose ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lost ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Make ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' manage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mastered ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' match ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' matches ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' media ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meeting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meets ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' met ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' millions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mixed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' More ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' moving ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Ms ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' muscles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' names ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' natural ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' normal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Now ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' o ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' object ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' observed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' offering ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' oil ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Once ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ones ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Only ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' onto ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Others ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Our ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' overcome ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' owner ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' penetrate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pharmacists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Polish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' posting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' potential ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Practice ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' practiced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' presenter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pretty ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' processing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' producing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' profit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Pronunciation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Psychologists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' puts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reads ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reasons ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recently ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recognizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' record ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reflect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' regret ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' repeated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' repeating ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reporters ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' requires ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ride ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Right ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sad ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sales ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' save ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' screen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' script ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' secretly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Set ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Several ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shared ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sharing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' signals ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Similar ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' six ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' slow ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' solution ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sometime ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speech ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spoke ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' star ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' starting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' starts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' subtitles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Such ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' switching ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tactics ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' talent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' taught ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' teach ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tells ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' terms ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' textbooks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Things ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thousand ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tired ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tired-looking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' top ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tour ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' town ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' trade ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' uncomfortable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' uncommon ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' underlined ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' united ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unrelated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' upon ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' valuable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' variation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' waking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wants ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' websites ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' weeks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' well-known ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Whatever ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' within ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' worth ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Youtube ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 100 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 15 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2nd ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 50 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 60 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' absolutely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' absorb ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' accept ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' accomplishing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' add ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' address ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' afraid ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Americans ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Angeles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' appropriate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' attempts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' away ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' beautifully ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' biggest ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' body ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bold ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' boost ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bored ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' camera-shy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' caught ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cha ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chances ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chapter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' closing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' coffee ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' collapsed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comfortable ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' coming ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' communicate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comprehension ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' consonants ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' continue ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' continuously ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' control ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conversations ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' copy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' couple ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' customers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dance ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' deal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' definitely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' developed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' disadvantage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dry ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Each ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ears ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' effective ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' effectively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' entire ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' estate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' everyone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' excited ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' experience ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' explain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' explanation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' eyes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fluency ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' focused ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' formed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' freely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' front ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gives ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' goal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hands ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Have ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Here ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' herself ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' him ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hips ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hot ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ignore ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' image ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' imagine ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Input ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' instruct ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' instructed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' instructing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' international ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' intonation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Is ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' kept ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' key ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' knew ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' knowing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Language ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' larger ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' last ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Learning ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' learns ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' least ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' life ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' living ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Los ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Massive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' methods ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' months ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' movie ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' myself ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' negative ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' News ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' No ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' observe ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' obstacles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' off ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Or ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Other ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' overshadowed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' painless ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' past ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' patient ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pattern ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' personality ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' player ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' point ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' positive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' powerful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' present ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' principle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' professional ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronounced ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' purely ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Read ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' realize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' receive ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' relate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' related ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' relax ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' replace ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' results ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' review ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' running ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' saying ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' secret ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seeing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seeking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seems ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' selecting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' separately ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seriously ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shorter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' since ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' site ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sneaked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' soon ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' state ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stressed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' studies ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' success ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' suggestion ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' support ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Take ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' teachers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tempted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Think ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thinking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' third ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thought ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' took ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' typical ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' under ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' understanding ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' understood ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Use ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' utilize ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' video ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' watch ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Watchers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' watching ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Weight ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Where ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' worrying ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wrong ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 20 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 6 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 7 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' access ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' admitted ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' affect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' along ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' although ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Andrew ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' anything ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' assume ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' audience ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Because ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' become ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bring ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' channels ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' checking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clear ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' close ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' comments ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' concepts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' context ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' costs ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' days ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' describe ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' details ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' determine ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Develop ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' difference ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' discuss ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' due ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' during ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' early ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' excuse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fact ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' factor ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' far ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fast ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fear ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' finish ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forget ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' four ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' free ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' frequency ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' friend ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fully ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' gone ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hears ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' humanitarian ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' illustrate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interested ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' job ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' join ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' kind ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' knowledge ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' later ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Learn ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' level ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' listened ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' looks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' loud ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' main ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Mapping ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mean ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mine ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' motivation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' name ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' naturally ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' often ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' once ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Pareto ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' parts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' personal ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' piece ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' plural ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' previous ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Prince ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' prior ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proactively ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' produce ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronoun ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' putting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' red-carpet ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reduce ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' selling ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sites ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' situation ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Small ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sorry ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speaks ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spoken ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stories ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' story ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tactic ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' takes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' talked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Technique ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tends ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tense ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' told ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tools ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' translate ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' underline ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' useful ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' videotape ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' visit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vowels ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' wake ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' waste ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' went ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1st ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 30 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 3000 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 3rd ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' agree ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ahead ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' always ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' American ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Another ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' belong ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Comprehension ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' conditional ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' connections ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ever ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' everyday ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' face ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' family ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' felt ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' financial ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' group ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' having ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' high ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hip ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' huge ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' human ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' impact ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' instead ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lapse ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Let ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' line ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' list ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' little ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' looking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' makes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' matter ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' memorizing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' music ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' My ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' nothing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' old ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' On ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' open ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' parents ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' properly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' questions ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' research ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' role ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sample ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' serious ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' simpler ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' simplified ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' singular ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skill ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sleep ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' smart ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' software ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sometimes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' somewhere ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Steve ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' structure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' style ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' subtitle ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Then ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' total ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tried ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tries ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' US ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' voice ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' waiting ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' website ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' With ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' achieve ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' advantage ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' almost ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' among ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' around ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' aware ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Below ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' best ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' break ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Business ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' change ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' complicated ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' concept ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' data ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' day ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' develop ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' developing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' easy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' effort ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' efforts ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fail ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' figure ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' force ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' game ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' goes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ideas ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Listen ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' longer ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' looked ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' made ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' minutes ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' newspaper ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' numbers ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' perfect ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pick ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' result ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' run ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sense ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' session ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' shows ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' single ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skip ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' small ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sources ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' together ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' unconsciously ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' version ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' well ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' whatever ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' whether ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' works ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' world ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' yet ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' accent ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' according ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Although ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' author ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' based ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Before ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' being ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bit ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' By ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' clearly ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' contain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' easily ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' end ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' environment ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forum ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' forums ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' further ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' improve ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Internet ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' non-native ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' now ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' occurrences ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' page ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' problems ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rather ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' REM ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' retain ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Sarah ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' seem ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' started ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stop ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' strategy ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stress ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' structures ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tool ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' uses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' While ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' working ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 2 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 4 ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' acquiring ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' amount ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' articles ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' back ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' bad ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' better ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' big ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' building ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' businesses ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' called ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chance ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' class ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' country ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' daily ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' described ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' down ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' everything ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exposed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' factors ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fluently ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' follow ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' kids ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' let ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' linguists ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' materials ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meet ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' million ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Of ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' office ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' online ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' others ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' period ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' play ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' probably ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' proper ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recall ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' section ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' select ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' short ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Sound ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' source ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Speaking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speed ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' subject ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' talking ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' things ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' true ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' TV ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ways ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Writing ',
  wrap: 'span',
  wrapClass: 'redc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 5 ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' above ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' approach ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' both ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' business, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Cha ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' computer ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' day, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' each ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' English. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' exactly ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' familiar ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' friends ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' great ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' How ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' interesting ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Labuda ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Let’s ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' local ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' material ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meaning. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' method ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' output ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' paragraph ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skills. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speakers ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' step ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' step, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' studying ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' teacher ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Well, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' word, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' worry ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Your ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 10 ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' again ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' area ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' between ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' book, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' company ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Do ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' done ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' easier ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' form ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' getting ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' give ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' move ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' never ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' no. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' note ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' own ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' phrase ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Please ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' process. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronunciation. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' question ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' real ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' repeat ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' search ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' She ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' specific ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' until ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 1, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' ask ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' case ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' companies ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' dictionary ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' enough ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Every ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' keep ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' lot ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' making ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' map ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' means ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' similar ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' simple ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Since ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' so, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' solve ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Some ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' stressing ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tend ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' trying ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' type ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' usually ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' way. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' word. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' years ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' you’ve ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' answer ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' basic ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' call ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' example ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' half ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' heard ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' learner ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' less ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' let’s ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' massive ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' post ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' rules ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' say ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' says ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' several ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' show ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' So, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' someone ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' time. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Vietnamese ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' while ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' + ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' 3 ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' books ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' chapter, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' fact, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' found ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hard ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' He ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' home-based ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Many ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' master ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mind ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' money ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' normally ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' please ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' said ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speaker’s ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' spend ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' students ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' technique, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' though ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' topic ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' transcript ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' freq.txt ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hl.js ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' le1.txt ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' le2.txt ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' le3.txt ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-102_1.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-103_1.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-103_2.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-103_3.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-14_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-18_1.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-19_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-21_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-38_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-43_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-47_1.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-47_2.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-48_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-52_1.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-63_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-63_2.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-64_1.jpg ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-66_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-66_2.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-67_1.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf-67_2.png ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' outfile-cuongvm-2-5-Steps_636712202000421116.pdf.html ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' output-cuongvm-2-5-Steps_636712202000421116.pdf.txt ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' style.css ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' actually ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' article ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' believe ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' likely ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mentioned ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' plan ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' second ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sentences ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' skills ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' something ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sounds ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' That ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' them. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' There ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' come ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' content ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Ferguson ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Free ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' got ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' home ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' must ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' news ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' problem ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quickly ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' really ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' share ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sure ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' times ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tongue ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' written ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' difficult ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' focus ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' happens ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' helps ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' listen ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reason ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' recognize ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' various ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' We ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' you. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' A ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' After ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' check ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Chinese ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' feel ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Now, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' right ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' yourself ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' certain ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' had ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' idea ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Just ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronounce ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' tell ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Therefore, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' used ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' already ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Chapter ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' every ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' express ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' few ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' process ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' put ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' three ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' through ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' To ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' us ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' work ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' another ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' English, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' important ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' language, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' learned ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' steps ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' What ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' whole ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' before ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' doing ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' meaning ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' person ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' phrases ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' pronunciation ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Reading ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' talk ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' did ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' foreign ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' here ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' start ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' following ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' information ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' memorize ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' quite ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' technique ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' then ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' book ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' hear ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' next ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' order ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' too ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' example, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' For ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' its ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' out ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' over ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' she ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' They ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' way ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' And ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sentence ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' where ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: '  ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' input ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' number ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' thing ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' those ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' were ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' words, ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' after ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' been ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' mother ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' words. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' write ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' core ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' look ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' without ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' does ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' remember ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' still ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' learners ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' long ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speaker ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' take ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' understand ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' using ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' vocabulary ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' it. ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' these ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' go ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' good ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' read ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' any ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' But ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' cannot ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' me ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' practicing ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' think ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' no ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' also ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' business ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' Step ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' find ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' brain ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' help ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' into ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' same ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' because ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' might ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' much ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' such ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' target ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' than ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' there ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' writing ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' even ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' our ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' reading ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' see ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' who ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' why ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' English ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' try ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' only ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' able ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' all ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' going ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' other ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' sound ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' her ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' native ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' don’t ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
findAndReplaceDOMText(document.body, {
  find: ' speaking ',
  wrap: 'span',
  wrapClass: 'greenc'
  }
);
